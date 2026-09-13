from __future__ import annotations

import json
import random
import subprocess
from pathlib import Path
from typing import Any

import gymnasium as gym
import numpy as np
from gymnasium import spaces

ROOT = Path(__file__).resolve().parents[1]
SERVER = ROOT / "rl" / "server.mjs"


class NodeBridge:
    def __init__(self, node_bin: str = "node") -> None:
        self.proc = subprocess.Popen(
            [node_bin, str(SERVER)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
            cwd=ROOT,
        )
        self.spec = self.request({"cmd": "spec"})

    def request(self, message: dict[str, Any]) -> dict[str, Any]:
        if self.proc.poll() is not None:
            stderr = self.proc.stderr.read() if self.proc.stderr else ""
            raise RuntimeError(f"Node server exited early: {stderr}")
        assert self.proc.stdin is not None and self.proc.stdout is not None
        self.proc.stdin.write(json.dumps(message, ensure_ascii=False) + "\n")
        self.proc.stdin.flush()
        line = self.proc.stdout.readline()
        if not line:
            stderr = self.proc.stderr.read() if self.proc.stderr else ""
            raise RuntimeError(f"Node server returned EOF: {stderr}")
        response = json.loads(line)
        if not response.get("ok"):
            raise RuntimeError(response.get("error", "Unknown Node server error"))
        return response

    def close(self) -> None:
        if self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=2)
            except subprocess.TimeoutExpired:
                self.proc.kill()


class GirlsCardGameEnv(gym.Env):
    metadata = {"render_modes": []}

    def __init__(
        self,
        *,
        max_actions: int = 1000,
        randomize_seat: bool = True,
        node_bin: str = "node",
        seed: int | None = None,
    ) -> None:
        super().__init__()
        self.bridge = NodeBridge(node_bin=node_bin)
        self.action_space = spaces.Discrete(int(self.bridge.spec["actionCount"]))
        self.observation_space = spaces.Box(
            low=0.0,
            high=1.0,
            shape=(int(self.bridge.spec["observationSize"]),),
            dtype=np.float32,
        )
        self.max_actions = max_actions
        self.randomize_seat = randomize_seat
        self.py_rng = random.Random(seed)
        self.agent_player = 0
        self.opponent_model = None
        self._last: dict[str, Any] | None = None
        self._actions = 0

    def set_opponent_model(self, model) -> None:
        self.opponent_model = model

    def action_masks(self) -> np.ndarray:
        if not self._last:
            return np.zeros(self.action_space.n, dtype=bool)
        return np.asarray(self._last["mask"], dtype=bool)

    def _choose_opponent_action(self, state: dict[str, Any]) -> int:
        mask = np.asarray(state["mask"], dtype=bool)
        legal = np.flatnonzero(mask)
        if legal.size == 0:
            raise RuntimeError("Opponent has no legal action in a non-terminal state")
        if self.opponent_model is None:
            return int(self.py_rng.choice(legal.tolist()))
        action, _ = self.opponent_model.predict(
            np.asarray(state["observation"], dtype=np.float32),
            deterministic=False,
            action_masks=mask,
        )
        return int(action)

    def _advance_opponent(self, state: dict[str, Any]) -> tuple[dict[str, Any], bool]:
        truncated = False
        while not state["terminated"] and state["player"] != self.agent_player:
            if self._actions >= self.max_actions:
                truncated = True
                break
            action = self._choose_opponent_action(state)
            state = self.bridge.request({"cmd": "step", "action": action})
            self._actions += 1
        return state, truncated

    def _obs(self, state: dict[str, Any]) -> np.ndarray:
        return np.asarray(state["observation"], dtype=np.float32)

    def _info(self, state: dict[str, Any]) -> dict[str, Any]:
        return {
            "agent_player": self.agent_player,
            "winner": state.get("winner"),
            "turn": state.get("turn"),
            "stats": state.get("stats", {}),
        }

    def reset(self, *, seed: int | None = None, options: dict | None = None):
        super().reset(seed=seed)
        if seed is not None:
            self.py_rng.seed(seed)
        self.agent_player = self.py_rng.randrange(2) if self.randomize_seat else 0
        self._actions = 0
        game_seed = self.py_rng.randrange(1, 2**31 - 1)
        state = self.bridge.request({
            "cmd": "reset",
            "seed": game_seed,
            "characters": ["madoka", "mami"],
        })
        state, truncated = self._advance_opponent(state)
        if truncated:
            raise RuntimeError("Episode truncated during reset before the learning agent received priority")
        self._last = state
        return self._obs(state), self._info(state)

    def step(self, action: int):
        if self._last is None:
            raise RuntimeError("Call reset() before step().")
        if self._last["terminated"]:
            raise RuntimeError("Episode already terminated.")
        if self._last["player"] != self.agent_player:
            raise RuntimeError("It is not the learning agent's decision.")
        mask = self.action_masks()
        if action < 0 or action >= self.action_space.n or not mask[action]:
            raise ValueError(f"Illegal masked action: {action}")

        state = self.bridge.request({"cmd": "step", "action": int(action)})
        self._actions += 1
        truncated = self._actions >= self.max_actions and not state["terminated"]
        if not truncated:
            state, opponent_truncated = self._advance_opponent(state)
            truncated = truncated or opponent_truncated

        terminated = bool(state["terminated"])
        reward = 0.0
        if terminated:
            reward = 1.0 if state.get("winner") == self.agent_player else -1.0
        self._last = state
        return self._obs(state), reward, terminated, truncated, self._info(state)

    def close(self) -> None:
        self.bridge.close()
        super().close()

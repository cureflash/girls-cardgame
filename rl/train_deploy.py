"""Reproducible compact policy training, validation and browser export."""
from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import numpy as np
import torch
from sb3_contrib import MaskablePPO
from stable_baselines3.common.callbacks import BaseCallback

from env import GirlsCardGameEnv


def report(**values):
    print(json.dumps(values, ensure_ascii=False), flush=True)


class TrainingProgress(BaseCallback):
    def _on_step(self):
        if self.num_timesteps % 8192 == 0:
            report(stage="ppo-progress", timesteps=self.num_timesteps)
        return True


def evaluate(model, games, seed, opponent="baseline", fixtures=None):
    env = GirlsCardGameEnv(max_actions=600, randomize_seat=True, seed=seed)
    if opponent == "baseline":
        env.set_opponent_baseline()
    counts = {"games": games, "wins": 0, "losses": 0, "truncated": 0, "byCharacter": {"madoka": [0, 0], "mami": [0, 0]}}
    try:
        for game in range(games):
            obs, info = env.reset(seed=seed + game)
            terminated = truncated = False
            while not terminated and not truncated:
                mask = env.action_masks()
                action, _ = model.predict(obs, deterministic=True, action_masks=mask)
                if fixtures is not None and len(fixtures) < 32:
                    fixtures.append({"observation": obs.tolist(), "legal": np.flatnonzero(mask).tolist(), "action": int(action)})
                obs, reward, terminated, truncated, info = env.step(int(action))
            if truncated:
                counts["truncated"] += 1
            else:
                win = reward > 0
                counts["wins" if win else "losses"] += 1
                character = "madoka" if info["agent_player"] == 0 else "mami"
                counts["byCharacter"][character][0 if win else 1] += 1
    finally:
        env.close()
    counts["winRate"] = counts["wins"] / max(1, games - counts["truncated"])
    return counts


def export_policy(model, spec, destination):
    layers = []
    modules = list(model.policy.mlp_extractor.policy_net) + [model.policy.action_net]
    for index, module in enumerate(modules):
        if not isinstance(module, torch.nn.Linear):
            continue
        following = modules[index + 1] if index + 1 < len(modules) else None
        activation = "tanh" if isinstance(following, torch.nn.Tanh) else "relu" if isinstance(following, torch.nn.ReLU) else "linear"
        compact = lambda value: float(f"{float(value):.7g}")
        layers.append({"activation": activation,
                       "weights": [[compact(v) for v in row] for row in module.weight.detach().cpu().numpy()],
                       "bias": [compact(v) for v in module.bias.detach().cpu().numpy()]})
    output = {"format": "girls-cardgame-mlp-v1", "rulesVersion": spec["rulesVersion"],
              "observationSize": spec["observationSize"], "actionCount": spec["actionCount"],
              "characters": ["madoka", "mami"], "layers": layers}
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(output, separators=(",", ":")), encoding="utf-8")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=Path("models/sites-training"))
    parser.add_argument("--warmup-decisions", type=int, default=12000)
    parser.add_argument("--warmup-epochs", type=int, default=16)
    parser.add_argument("--generations", type=int, default=4)
    parser.add_argument("--steps-per-generation", type=int, default=32768)
    parser.add_argument("--eval-games", type=int, default=48)
    parser.add_argument("--seed", type=int, default=20261101)
    args = parser.parse_args()
    torch.set_num_threads(4)
    torch.set_num_interop_threads(1)
    np.random.seed(args.seed)
    args.output.mkdir(parents=True, exist_ok=True)
    started = time.monotonic()
    env = GirlsCardGameEnv(max_actions=600, randomize_seat=True, seed=args.seed)
    env.set_opponent_baseline()
    model = MaskablePPO("MlpPolicy", env, seed=args.seed, device="cpu", verbose=0,
                        n_steps=1024, batch_size=256, n_epochs=4, learning_rate=2e-4,
                        ent_coef=0.01, policy_kwargs={"net_arch": [96, 96]})
    spec = env.bridge.spec
    report(stage="setup", spec=spec, torch=torch.__version__, architecture=[96, 96])
    observations, masks, actions = [], [], []
    try:
        obs, _ = env.reset(seed=args.seed)
        for i in range(args.warmup_decisions):
            mask = env.action_masks()
            action = int(env.bridge.request({"cmd": "expert-action"})["action"])
            observations.append(obs.copy())
            masks.append(mask.copy())
            actions.append(action)
            obs, _, done, truncated, _ = env.step(action)
            if done or truncated:
                obs, _ = env.reset()
            if (i + 1) % 2000 == 0:
                report(stage="collect-expert", decisions=i + 1, seconds=round(time.monotonic() - started, 1))
        x = torch.tensor(np.asarray(observations), dtype=torch.float32)
        mask_tensor = torch.tensor(np.asarray(masks), dtype=torch.bool)
        y = torch.tensor(actions, dtype=torch.long)
        del observations, masks, actions
        optimizer = torch.optim.Adam(model.policy.parameters(), lr=8e-4)
        model.policy.set_training_mode(True)
        for epoch in range(args.warmup_epochs):
            order = torch.randperm(len(y))
            total_loss = total_correct = 0
            for batch in order.split(256):
                distribution = model.policy.get_distribution(x[batch], action_masks=mask_tensor[batch])
                loss = -distribution.log_prob(y[batch]).mean()
                optimizer.zero_grad()
                loss.backward()
                torch.nn.utils.clip_grad_norm_(model.policy.parameters(), 1.0)
                optimizer.step()
                total_loss += float(loss.detach()) * len(batch)
                total_correct += int((distribution.get_actions(deterministic=True) == y[batch]).sum())
            report(stage="warmup", epoch=epoch + 1, loss=total_loss / len(y), accuracy=total_correct / len(y), seconds=round(time.monotonic() - started, 1))
        del x, mask_tensor, y
        model.save(args.output / "warmup")
        records = []
        best_score = -1
        best_path = None
        candidates = [("warmup", args.output / "warmup.zip")]
        for generation in range(args.generations + 1):
            if generation:
                if generation % 2 == 0:
                    env.set_opponent_model(MaskablePPO.load(candidates[-1][1], device="cpu"))
                    opponent_name = "previous-snapshot"
                else:
                    env.set_opponent_baseline()
                    opponent_name = "baseline"
                report(stage="ppo-start", generation=generation, opponent=opponent_name)
                model.learn(total_timesteps=args.steps_per_generation, reset_num_timesteps=False, callback=TrainingProgress())
                path = args.output / f"ppo-{generation:02d}.zip"
                model.save(path)
                candidates.append((f"ppo-{generation:02d}", path))
            name, path = candidates[-1]
            baseline = evaluate(model, args.eval_games, 910000, "baseline")
            random_result = evaluate(model, args.eval_games, 920000, "random")
            row = {"candidate": name, "timesteps": model.num_timesteps, "baseline": baseline, "random": random_result}
            records.append(row)
            score = baseline["winRate"] - baseline["truncated"] / args.eval_games
            if score > best_score:
                best_score, best_path = score, path
                model.save(args.output / "best")
                export_policy(model, spec, args.output / "policy.json")
            report(stage="evaluate", **row, best=str(best_path), seconds=round(time.monotonic() - started, 1))
            (args.output / "progress.json").write_text(json.dumps(records, indent=2))
        best = MaskablePPO.load(args.output / "best.zip", device="cpu")
        fixtures = []
        final_baseline = evaluate(best, 100, 930000, "baseline", fixtures)
        final_random = evaluate(best, 100, 940000, "random")
        export_policy(best, spec, args.output / "policy.json")
        (args.output / "parity-fixtures.json").write_text(json.dumps(fixtures, separators=(",", ":")))
        summary = {"seed": args.seed, "rulesVersion": spec["rulesVersion"], "architecture": [96, 96],
                   "warmupDecisions": args.warmup_decisions, "warmupEpochs": args.warmup_epochs,
                   "totalPpoSteps": model.num_timesteps, "bestCandidate": str(best_path.name),
                   "validation": records, "heldOutBaseline": final_baseline, "heldOutRandom": final_random,
                   "durationSeconds": round(time.monotonic() - started, 1)}
        (args.output / "report.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2))
        report(stage="finished", **summary)
    finally:
        env.close()


if __name__ == "__main__":
    main()

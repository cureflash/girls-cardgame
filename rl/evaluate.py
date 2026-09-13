from __future__ import annotations

import argparse
import json
from pathlib import Path

from sb3_contrib import MaskablePPO

from env import GirlsCardGameEnv


def main() -> None:
    parser = argparse.ArgumentParser(description="Evaluate a trained girls-cardgame policy.")
    parser.add_argument("model", type=Path)
    parser.add_argument("--opponent", type=Path, default=None)
    parser.add_argument("--games", type=int, default=1000)
    parser.add_argument("--seed", type=int, default=1000)
    parser.add_argument("--max-actions", type=int, default=1000)
    args = parser.parse_args()

    model = MaskablePPO.load(args.model)
    opponent = MaskablePPO.load(args.opponent) if args.opponent else None
    env = GirlsCardGameEnv(max_actions=args.max_actions, randomize_seat=True, seed=args.seed)
    env.set_opponent_model(opponent)

    result = {
        "games": args.games,
        "wins": 0,
        "losses": 0,
        "truncated": 0,
        "turns": 0,
        "actions": 0,
        "damageTaken": 0,
        "earlyDamageTaken": 0,
        "damageEvents": 0,
        "threeNPlusOneEvents": 0,
        "witchSummons": 0,
        "chainCards": 0,
        "specials": 0,
    }

    try:
        for game in range(args.games):
            obs, info = env.reset(seed=args.seed + game)
            terminated = truncated = False
            reward = 0.0
            while not terminated and not truncated:
                mask = env.action_masks()
                action, _ = model.predict(obs, deterministic=True, action_masks=mask)
                obs, reward, terminated, truncated, info = env.step(int(action))

            if truncated:
                result["truncated"] += 1
            elif reward > 0:
                result["wins"] += 1
            else:
                result["losses"] += 1

            stats = info.get("stats", {})
            p = info["agent_player"]
            result["turns"] += int(info.get("turn") or 0)
            result["actions"] += int(stats.get("actions", 0))
            for key in (
                "damageTaken",
                "earlyDamageTaken",
                "damageEvents",
                "threeNPlusOneEvents",
                "witchSummons",
                "chainCards",
                "specials",
            ):
                values = stats.get(key, [0, 0])
                result[key] += int(values[p]) if isinstance(values, list) else int(values)
    finally:
        env.close()

    completed = max(1, args.games - result["truncated"])
    output = {
        **result,
        "winRate": result["wins"] / completed,
        "averageTurns": result["turns"] / args.games,
        "averageActions": result["actions"] / args.games,
        "threeNPlusOneRate": (
            result["threeNPlusOneEvents"] / result["damageEvents"]
            if result["damageEvents"] else 0.0
        ),
    }
    print(json.dumps(output, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

from __future__ import annotations

import argparse
import random
from pathlib import Path

from sb3_contrib import MaskablePPO

from env import GirlsCardGameEnv


def main() -> None:
    parser = argparse.ArgumentParser(description="Train a self-play MaskablePPO agent for girls-cardgame.")
    parser.add_argument("--generations", type=int, default=20)
    parser.add_argument("--steps-per-generation", type=int, default=100_000)
    parser.add_argument("--seed", type=int, default=1)
    parser.add_argument("--model-dir", type=Path, default=Path("models"))
    parser.add_argument("--max-actions", type=int, default=1000)
    args = parser.parse_args()

    args.model_dir.mkdir(parents=True, exist_ok=True)
    rng = random.Random(args.seed)
    env = GirlsCardGameEnv(max_actions=args.max_actions, randomize_seat=True, seed=args.seed)
    model = MaskablePPO(
        "MlpPolicy",
        env,
        verbose=1,
        seed=args.seed,
        n_steps=2048,
        batch_size=256,
        policy_kwargs={"net_arch": [256, 256]},
    )

    snapshots: list[Path] = []
    try:
        for generation in range(args.generations):
            if snapshots:
                pool = snapshots[-8:]
                opponent_path = rng.choice(pool)
                env.set_opponent_model(MaskablePPO.load(opponent_path))
                print(f"generation={generation} opponent={opponent_path}")
            else:
                env.set_opponent_model(None)
                print(f"generation={generation} opponent=random")

            model.learn(
                total_timesteps=args.steps_per_generation,
                reset_num_timesteps=False,
                progress_bar=False,
            )
            snapshot = args.model_dir / f"policy_{generation:03d}"
            model.save(snapshot)
            snapshots.append(snapshot.with_suffix(".zip"))
            print(f"saved={snapshots[-1]}")
    finally:
        env.close()


if __name__ == "__main__":
    main()

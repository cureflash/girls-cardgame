"""Correct imitation errors on states reached by the learned policy (DAgger)."""
from __future__ import annotations

import argparse
import json
import shutil
import time
from pathlib import Path

import numpy as np
import torch
from sb3_contrib import MaskablePPO

from env import GirlsCardGameEnv
from train_deploy import evaluate, export_policy, report


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("checkpoint", type=Path)
    parser.add_argument("--output", type=Path, default=Path("models/sites-refinement"))
    parser.add_argument("--iterations", type=int, default=4)
    parser.add_argument("--decisions", type=int, default=8000)
    parser.add_argument("--epochs", type=int, default=12)
    parser.add_argument("--seed", type=int, default=20261102)
    args = parser.parse_args()
    torch.set_num_threads(2)
    torch.set_num_interop_threads(1)
    torch.manual_seed(args.seed)
    np.random.seed(args.seed)
    rng = np.random.default_rng(args.seed)
    started = time.monotonic()
    args.output.mkdir(parents=True, exist_ok=True)
    model = MaskablePPO.load(args.checkpoint, device="cpu")
    env = GirlsCardGameEnv(max_actions=600, randomize_seat=True, seed=args.seed)
    env.set_opponent_baseline()
    spec = env.bridge.spec
    optimizer = torch.optim.Adam(model.policy.parameters(), lr=3e-4)
    replay_x, replay_masks, replay_y = [], [], []
    records, best_score, best_name = [], -1, None
    try:
        for iteration in range(1, args.iterations + 1):
            obs, _ = env.reset(seed=args.seed + iteration * 1000)
            xs, masks, ys = [], [], []
            for decision in range(args.decisions):
                mask = env.action_masks()
                expert = int(env.bridge.request({"cmd": "expert-action"})["action"])
                xs.append(obs.copy())
                masks.append(mask.copy())
                ys.append(expert)
                action, _ = model.predict(obs, deterministic=True, action_masks=mask)
                # Keep some expert trajectories in the first pass, then visit the
                # deployed policy's own states so errors do not compound unseen.
                if iteration == 1 and rng.random() < 0.25:
                    action = expert
                obs, _, done, truncated, _ = env.step(int(action))
                if done or truncated:
                    obs, _ = env.reset()
                if (decision + 1) % 2000 == 0:
                    report(stage="dagger-collect", iteration=iteration, decisions=decision + 1,
                           seconds=round(time.monotonic() - started, 1))
            replay_x.append(np.asarray(xs))
            replay_masks.append(np.asarray(masks))
            replay_y.append(np.asarray(ys))
            del xs, masks, ys
            x = torch.tensor(np.concatenate(replay_x), dtype=torch.float32)
            mask_tensor = torch.tensor(np.concatenate(replay_masks), dtype=torch.bool)
            y = torch.tensor(np.concatenate(replay_y), dtype=torch.long)
            model.policy.set_training_mode(True)
            for epoch in range(args.epochs):
                total_loss = total_correct = 0
                for batch in torch.randperm(len(y)).split(256):
                    dist = model.policy.get_distribution(x[batch], action_masks=mask_tensor[batch])
                    loss = -dist.log_prob(y[batch]).mean()
                    optimizer.zero_grad()
                    loss.backward()
                    torch.nn.utils.clip_grad_norm_(model.policy.parameters(), 1.0)
                    optimizer.step()
                    total_loss += float(loss.detach()) * len(batch)
                    total_correct += int((dist.get_actions(deterministic=True) == y[batch]).sum())
                if epoch == args.epochs - 1:
                    report(stage="dagger-fit", iteration=iteration, decisions=len(y),
                           loss=total_loss / len(y), accuracy=total_correct / len(y))
            del x, mask_tensor, y
            name = f"dagger-{iteration:02d}"
            model.save(args.output / name)
            baseline = evaluate(model, 48, 910000, "baseline")
            random_result = evaluate(model, 48, 920000, "random")
            row = {"candidate": name, "baseline": baseline, "random": random_result}
            records.append(row)
            score = baseline["winRate"] - baseline["truncated"] / 48
            if score > best_score:
                best_score, best_name = score, name
                shutil.copyfile(args.output / f"{name}.zip", args.output / "best.zip")
                export_policy(model, spec, args.output / "policy.json")
            report(stage="dagger-evaluate", **row, seconds=round(time.monotonic() - started, 1))
            (args.output / "progress.json").write_text(json.dumps(records, indent=2))
        best = MaskablePPO.load(args.output / "best.zip", device="cpu")
        fixtures = []
        baseline = evaluate(best, 100, 930000, "baseline", fixtures)
        random_result = evaluate(best, 100, 940000, "random")
        export_policy(best, spec, args.output / "policy.json")
        (args.output / "parity-fixtures.json").write_text(json.dumps(fixtures, separators=(",", ":")))
        summary = {"method": "DAgger", "sourceCheckpoint": str(args.checkpoint), "seed": args.seed,
                   "rulesVersion": spec["rulesVersion"], "additionalExpertDecisions": args.iterations * args.decisions,
                   "epochsPerIteration": args.epochs, "bestCandidate": best_name,
                   "validation": records, "heldOutBaseline": baseline, "heldOutRandom": random_result,
                   "durationSeconds": round(time.monotonic() - started, 1)}
        (args.output / "report.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2))
        report(stage="dagger-finished", **summary)
    finally:
        env.close()


if __name__ == "__main__":
    main()

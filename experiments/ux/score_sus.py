"""Score SUS responses and compare platforms.

    python experiments/ux/score_sus.py experiments/ux/sus-responses.csv

SUS (Brooke 1996): odd items r-1, even items 5-r, sum x 2.5 -> 0..100.
Adjective bands from Bangor, Kortum & Miller (2009).
"""
import itertools
import sys

import numpy as np
import pandas as pd
from scipy import stats

BANDS = [(85.5, "Excellent"), (72.6, "Good"), (52.1, "OK"), (25.1, "Poor"), (0, "Worst imaginable")]


def sus(row) -> float:
    odd = sum(row[f"q{i}"] - 1 for i in (1, 3, 5, 7, 9))
    even = sum(5 - row[f"q{i}"] for i in (2, 4, 6, 8, 10))
    return (odd + even) * 2.5


def band(score: float) -> str:
    return next(name for cut, name in BANDS if score >= cut)


def main(path: str) -> None:
    df = pd.read_csv(path)
    if df.empty:
        print("No responses yet - run the protocol in experiments/ux/README.md first.")
        return
    df["sus"] = df.apply(sus, axis=1)
    print("Platform        n   mean    SD    95% CI           band")
    for platform, g in df.groupby("platform"):
        x = g["sus"].to_numpy()
        lo, hi = stats.t.interval(0.95, len(x) - 1, loc=x.mean(), scale=stats.sem(x)) if len(x) > 1 else (x[0], x[0])
        print(f"{platform:<14}{len(x):>3}  {x.mean():5.1f}  {x.std(ddof=1) if len(x) > 1 else 0:5.1f}  [{lo:5.1f}, {hi:5.1f}]  {band(x.mean())}")

    wide = df.pivot_table(index="participant", columns="platform", values="sus").dropna()
    if wide.shape[1] >= 3 and len(wide) >= 3:
        chi, p = stats.friedmanchisquare(*[wide[c] for c in wide.columns])
        print(f"\nFriedman chi2 = {chi:.2f}, p = {p:.4f} (n = {len(wide)} complete participants)")
        pairs = list(itertools.combinations(wide.columns, 2))
        ps = [stats.wilcoxon(wide[a], wide[b]).pvalue for a, b in pairs]
        order = np.argsort(ps)
        adj = np.empty(len(ps))
        running = 0.0
        for rank, i in enumerate(order):
            running = max(running, min(1.0, (len(ps) - rank) * ps[i]))
            adj[i] = running
        for (a, b), p_raw, p_adj in zip(pairs, ps, adj):
            print(f"  {a} vs {b}: Wilcoxon p = {p_raw:.4f}, Holm p = {p_adj:.4f}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "experiments/ux/sus-responses.csv")

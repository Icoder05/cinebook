# UX study kit: SUS and the competitor funnel

The automated experiments measure what software can measure: steps, clicks, keystrokes,
Keystroke-Level Model time, keyboard-only completion and WCAG violations (E6, E7). They
**cannot** measure perceived usability, so the report contains no SUS score for any
platform. This kit lets a SUS study be run properly and added to the dataset.

## 1. Protocol (about 20 minutes per participant)

1. Recruit 8 to 12 adults who have booked a cinema ticket online in the last year.
   Record only an anonymous id (P01, P02, …), age band and booking frequency.
2. Counterbalance the order of the three platforms (Latin square: ABC, BCA, CAB).
3. Task on every platform: *"Find a 2D evening show of any film in Bengaluru tomorrow,
   choose 2 adjacent seats, and go as far as the payment page."* On BookMyShow and District,
   **stop at the payment page**: never pay, and do not automate those sites.
4. For each platform, write in `funnel-sheet.csv`:
   - task time (stopwatch, from home page to payment page);
   - screens seen;
   - taps or clicks;
   - errors (wrong turns or back-tracks);
   - whether the fee breakdown was visible before the payment page;
   - completion (1/0).
5. Straight after each platform, the participant fills in the 10-item SUS
   (`sus-questionnaire.md`), one row in `sus-responses.csv`.

## 2. Scoring

```
python experiments/ux/score_sus.py experiments/ux/sus-responses.csv
```

**SUS** (Brooke 1996): odd items score r−1, even items 5−r, and the sum is ×2.5, giving 0–100.

The script reports per platform:
- mean ± SD;
- a 95 % t-interval;
- the Bangor et al. (2009) adjective band.

It also runs a Friedman test across platforms with pairwise Wilcoxon signed-rank tests,
Holm-adjusted.

## 3. Ethics

- Participation is voluntary and anonymous.
- Nobody pays on any platform.
- Competitor sites are used exactly as an ordinary customer would use them, by a human, within their terms.

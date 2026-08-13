/* D-1b calibration record (versioned). See signals.ts for the gate that
   enforces it. A .ts module (not .json) so the node test runner and the
   Vite bundler load it identically, with no import-attribute divergence. */

export const SIGNAL_THRESHOLDS = {
  "version": "1.0.0",
  "retention_days": 90,
  "note": "D-1b calibration record. Thresholds are a measurement output, not a guess: each kind carries the backtest window it was measured over, the measured volumes, and the volume bounds the build-time gate enforces. A kind whose measured emission volume falls outside its declared bounds — or whose calibration block is absent — is WITHHELD from the artifact with a typed reason, never emitted anyway.",
  "kinds": {
    "s1-large": {
      "params": {
        "min_lower_bound_usd": 250000
      },
      "dedupe_key": "txnId",
      "cooldown_days": 0,
      "min_history_days": 0,
      "calibration": {
        "backtest_from": "2014-01-29",
        "backtest_to": "2026-08-10",
        "measured": "731 rows over the backtest window; 9–34/month over the trailing 6 months (dev extract 17,055 rows; re-measure on the full 58k corpus before production publish)",
        "volume_bounds": {
          "max_per_30d": 120,
          "min_total_backtest": 50
        }
      }
    },
    "s2-first": {
      "params": {},
      "dedupe_key": "bioguide+ticker",
      "cooldown_days": 0,
      "min_history_days": 365,
      "calibration": {
        "backtest_from": "2014-01-29",
        "backtest_to": "2026-08-10",
        "measured": "first-disclosure is structural (one per member-ticker pair, ever); era scoping stated on every emission",
        "volume_bounds": {
          "max_per_30d": 400,
          "min_total_backtest": 1
        }
      }
    },
    "s3-cooccurrence": {
      "params": {
        "min_members": 4,
        "window_days": 14
      },
      "dedupe_key": "ticker+side+windowStart",
      "cooldown_days": 14,
      "min_history_days": 0,
      "calibration": {
        "backtest_from": "2026-01-01",
        "backtest_to": "2026-08-10",
        "measured": "largest 2026 cluster on a true 14-day trade-date window is 5 members (SPCX from 2026-06-12; MSFT from 2026-03-13) — >=3 too loose, >=5 nearly empty, so N=4",
        "volume_bounds": {
          "max_per_30d": 20,
          "min_total_backtest": 0
        }
      }
    },
    "s4-infrequent": {
      "params": {
        "max_prior_disclosures": 10,
        "min_lower_bound_usd": 50000,
        "side": "purchase"
      },
      "dedupe_key": "txnId",
      "cooldown_days": 0,
      "min_history_days": 365,
      "calibration": {
        "backtest_from": "2014-01-29",
        "backtest_to": "2026-08-10",
        "measured": "1,379 purchases with lower bound >= $50K in the corpus; the prior-count predicate cuts this to the infrequent-discloser tail (measured at build and bounded)",
        "volume_bounds": {
          "max_per_30d": 60,
          "min_total_backtest": 1
        }
      }
    },
    "s5-jurisdiction": {
      "params": {},
      "dedupe_key": "txnId",
      "cooldown_days": 0,
      "min_history_days": 0,
      "calibration": null
    },
    "s6-late-large": {
      "params": {
        "min_lower_bound_usd": 100000
      },
      "dedupe_key": "txnId",
      "cooldown_days": 0,
      "min_history_days": 0,
      "calibration": {
        "backtest_from": "2014-01-29",
        "backtest_to": "2026-08-10",
        "measured": "201 rows over the backtest window; reference examples: $500K-$1M filed 437 days late, $1M-$5M filed 208 days late",
        "volume_bounds": {
          "max_per_30d": 40,
          "min_total_backtest": 10
        }
      }
    }
  }
} as const;

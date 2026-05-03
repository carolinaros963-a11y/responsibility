from __future__ import annotations

import argparse
import json
import math
from dataclasses import asdict, dataclass
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np


@dataclass
class Scenario:
    audience: int = 60000
    minutes: int = 120
    gates: int = 36
    service_rate: float = 20.0
    peak_concentration: float = 1.20
    queue_threshold: int = 2500
    suspect_prevalence: float = 50 / 60000
    sensitivity: float = 0.95
    false_alarm: float = 0.005
    patrols: int = 6
    smart_bias: float = 0.55


def arrival_profile(scenario: Scenario) -> np.ndarray:
    """Non-homogeneous Poisson intensity for the 120 minutes before opening."""
    t = np.arange(scenario.minutes + 1)
    early_wave = np.exp(-0.5 * ((t - 68) / 18) ** 2)
    late_wave = 0.72 * np.exp(-0.5 * ((t - 102) / 9) ** 2)
    background = 0.22
    weights = background + scenario.peak_concentration * (early_wave + late_wave)
    return scenario.audience * weights / weights.sum()


def simulate_queue(scenario: Scenario, seed: int = 202405) -> dict[str, np.ndarray | float]:
    rng = np.random.default_rng(seed)
    lam = arrival_profile(scenario)
    arrivals = rng.poisson(lam)
    capacity_mean = scenario.gates * scenario.service_rate

    queue = np.zeros(scenario.minutes + 1, dtype=float)
    served = np.zeros(scenario.minutes + 1, dtype=float)
    waits = np.zeros(scenario.minutes + 1, dtype=float)

    q = 0.0
    for i, a in enumerate(arrivals):
        capacity = rng.poisson(capacity_mean)
        available = q + a
        s = min(available, capacity)
        q = max(0.0, available - s)
        queue[i] = q
        served[i] = s
        waits[i] = q / max(capacity_mean, 1)

    avg_wait = float(np.average(waits, weights=np.maximum(arrivals, 1)))
    return {
        "time": np.arange(scenario.minutes + 1),
        "lambda": lam,
        "arrivals": arrivals,
        "served": served,
        "queue": queue,
        "waits": waits,
        "max_queue": float(queue.max()),
        "avg_wait": avg_wait,
        "risk_minutes": float((queue > scenario.queue_threshold).sum()),
    }


def monte_carlo_queue(
    scenario: Scenario, trials: int = 300, seed: int = 202405
) -> dict[str, float | list[float]]:
    max_queues = []
    avg_waits = []
    risk_minutes = []
    for k in range(trials):
        result = simulate_queue(scenario, seed + k)
        max_queues.append(float(result["max_queue"]))
        avg_waits.append(float(result["avg_wait"]))
        risk_minutes.append(float(result["risk_minutes"]))

    max_queues_arr = np.asarray(max_queues)
    avg_waits_arr = np.asarray(avg_waits)
    risk_minutes_arr = np.asarray(risk_minutes)
    return {
        "trials": trials,
        "risk_probability": float(np.mean(max_queues_arr > scenario.queue_threshold)),
        "max_queue_mean": float(max_queues_arr.mean()),
        "max_queue_p90": float(np.percentile(max_queues_arr, 90)),
        "avg_wait_mean": float(avg_waits_arr.mean()),
        "avg_wait_p90": float(np.percentile(avg_waits_arr, 90)),
        "risk_minutes_mean": float(risk_minutes_arr.mean()),
        "max_queues": max_queues,
        "avg_waits": avg_waits,
    }


def recognition_metrics(scenario: Scenario) -> dict[str, float]:
    suspects = scenario.audience * scenario.suspect_prevalence
    normal = scenario.audience - suspects
    true_alerts = suspects * scenario.sensitivity
    false_alerts = normal * scenario.false_alarm
    total_alerts = true_alerts + false_alerts
    ppv = true_alerts / total_alerts if total_alerts else 0.0
    review_hours = false_alerts * 2 * 20 / 60
    return {
        "suspects": suspects,
        "true_alerts": true_alerts,
        "false_alerts": false_alerts,
        "total_alerts": total_alerts,
        "posterior_true_given_alert": ppv,
        "review_police_hours": review_hours,
    }


def simulate_patrol_once(
    patrols: int,
    smart_bias: float,
    seed: int,
    width: int = 12,
    height: int = 8,
    horizon: int = 90,
) -> tuple[int, list[list[tuple[int, int]]]]:
    rng = np.random.default_rng(seed)
    starts = [(0, 0), (0, height - 1), (width - 1, 0), (width - 1, height - 1), (2, 0), (9, height - 1)]
    target = np.array([8, 5])
    positions = [np.array(starts[i % len(starts)], dtype=int) for i in range(patrols)]
    paths = [[(int(pos[0]), int(pos[1]))] for pos in positions]

    for minute in range(1, horizon + 1):
        for idx, pos in enumerate(positions):
            if rng.random() < smart_bias:
                direction = np.sign(target - pos)
                if rng.random() < 0.5 and direction[0] != 0:
                    step = np.array([direction[0], 0])
                elif direction[1] != 0:
                    step = np.array([0, direction[1]])
                else:
                    step = np.array([direction[0], 0])
            else:
                directions = [np.array([1, 0]), np.array([-1, 0]), np.array([0, 1]), np.array([0, -1])]
                step = directions[int(rng.integers(0, 4))]

            pos = pos + step
            pos[0] = int(np.clip(pos[0], 0, width - 1))
            pos[1] = int(np.clip(pos[1], 0, height - 1))
            positions[idx] = pos
            paths[idx].append((int(pos[0]), int(pos[1])))
            if np.array_equal(pos, target):
                return minute, paths
    return horizon, paths


def monte_carlo_patrol(
    patrols: int, smart_bias: float, trials: int = 300, seed: int = 202405
) -> dict[str, float | list[int]]:
    times = []
    for k in range(trials):
        hit_time, _ = simulate_patrol_once(patrols, smart_bias, seed + 10000 + k)
        times.append(hit_time)
    times_arr = np.asarray(times)
    return {
        "median_hit_time": float(np.median(times_arr)),
        "p90_hit_time": float(np.percentile(times_arr, 90)),
        "miss_probability_45min": float(np.mean(times_arr > 45)),
        "times": times,
    }


def make_risk_grid(base: Scenario, output: Path) -> None:
    gates_values = np.array([34, 38, 42, 46, 50, 54, 58])
    peak_values = np.array([0.80, 1.00, 1.20, 1.40, 1.60, 1.80])
    grid = np.zeros((len(peak_values), len(gates_values)))
    for i, peak in enumerate(peak_values):
        for j, gates in enumerate(gates_values):
            s = Scenario(**{**asdict(base), "gates": int(gates), "peak_concentration": float(peak)})
            mc = monte_carlo_queue(s, trials=90, seed=303000 + i * 100 + j)
            grid[i, j] = mc["risk_probability"]

    fig, ax = plt.subplots(figsize=(8.2, 4.8), dpi=170)
    im = ax.imshow(grid, cmap="YlOrRd", vmin=0, vmax=1, aspect="auto", origin="lower")
    ax.set_xticks(np.arange(len(gates_values)), labels=gates_values)
    ax.set_yticks(np.arange(len(peak_values)), labels=[f"{v:.1f}" for v in peak_values])
    ax.set_xlabel("Security channels")
    ax.set_ylabel("Arrival concentration")
    ax.set_title("Probability that max queue exceeds threshold")
    for i in range(len(peak_values)):
        for j in range(len(gates_values)):
            ax.text(j, i, f"{grid[i, j]:.0%}", ha="center", va="center", fontsize=8)
    fig.colorbar(im, ax=ax, label="risk probability")
    fig.tight_layout()
    fig.savefig(output / "queue_risk_heatmap.png")
    plt.close(fig)


def make_figures(output: Path) -> dict[str, object]:
    output.mkdir(parents=True, exist_ok=True)
    scenario = Scenario()
    queue = simulate_queue(scenario)
    mc_queue = monte_carlo_queue(scenario)
    rec = recognition_metrics(scenario)
    patrol_random = monte_carlo_patrol(scenario.patrols, 0.10)
    patrol_smart = monte_carlo_patrol(scenario.patrols, scenario.smart_bias)
    hit_time, paths = simulate_patrol_once(scenario.patrols, scenario.smart_bias, 90909)

    t = queue["time"]
    fig, axes = plt.subplots(2, 1, figsize=(9, 6), dpi=170, sharex=True)
    axes[0].plot(t, queue["arrivals"], color="#2B6CB0", label="arrivals")
    axes[0].plot(t, np.full_like(t, scenario.gates * scenario.service_rate), color="#2F855A", label="mean service capacity")
    axes[0].set_ylabel("people / minute")
    axes[0].legend(loc="upper left", frameon=False)
    axes[0].set_title("Non-homogeneous Poisson arrival and gate capacity")
    axes[1].plot(t, queue["queue"], color="#C2410C", linewidth=2, label="queue length")
    axes[1].axhline(scenario.queue_threshold, color="#7C2D12", linestyle="--", label="risk threshold")
    axes[1].fill_between(t, queue["queue"], scenario.queue_threshold, where=queue["queue"] > scenario.queue_threshold, color="#FED7AA")
    axes[1].set_xlabel("minutes after gates open")
    axes[1].set_ylabel("people waiting")
    axes[1].legend(loc="upper left", frameon=False)
    fig.tight_layout()
    fig.savefig(output / "arrival_queue_story.png")
    plt.close(fig)

    make_risk_grid(scenario, output)

    fig, ax = plt.subplots(figsize=(8.2, 4.8), dpi=170)
    bins = np.arange(0, 95, 5)
    ax.hist(patrol_random["times"], bins=bins, alpha=0.60, color="#94A3B8", label="near-random patrol")
    ax.hist(patrol_smart["times"], bins=bins, alpha=0.68, color="#0F766E", label="biased to hotspots")
    ax.axvline(patrol_smart["median_hit_time"], color="#115E59", linestyle="--", linewidth=2)
    ax.set_xlabel("first discovery time (minutes)")
    ax.set_ylabel("simulation count")
    ax.set_title("First hitting time distribution for patrol discovery")
    ax.legend(frameon=False)
    fig.tight_layout()
    fig.savefig(output / "patrol_hit_time.png")
    plt.close(fig)

    false_rates = np.linspace(0.0005, 0.02, 80)
    ppv = []
    police_hours = []
    for f in false_rates:
        s = Scenario(**{**asdict(scenario), "false_alarm": float(f)})
        r = recognition_metrics(s)
        ppv.append(r["posterior_true_given_alert"])
        police_hours.append(r["review_police_hours"])
    fig, ax1 = plt.subplots(figsize=(8.2, 4.8), dpi=170)
    ax1.plot(false_rates * 100, np.asarray(ppv) * 100, color="#1D4ED8", linewidth=2.4)
    ax1.set_xlabel("false alarm rate (%)")
    ax1.set_ylabel("P(true suspect | alert) (%)", color="#1D4ED8")
    ax1.tick_params(axis="y", labelcolor="#1D4ED8")
    ax2 = ax1.twinx()
    ax2.plot(false_rates * 100, police_hours, color="#B45309", linewidth=2.4)
    ax2.set_ylabel("police review hours", color="#B45309")
    ax2.tick_params(axis="y", labelcolor="#B45309")
    ax1.set_title("Bayesian base-rate effect under rare incidents")
    fig.tight_layout()
    fig.savefig(output / "bayes_alert_tradeoff.png")
    plt.close(fig)

    metrics = {
        "scenario": asdict(scenario),
        "queue": {k: v for k, v in mc_queue.items() if not isinstance(v, list)},
        "single_queue": {
            "max_queue": queue["max_queue"],
            "avg_wait": queue["avg_wait"],
            "risk_minutes": queue["risk_minutes"],
        },
        "recognition": rec,
        "patrol_random": {k: v for k, v in patrol_random.items() if not isinstance(v, list)},
        "patrol_smart": {k: v for k, v in patrol_smart.items() if not isinstance(v, list)},
        "sample_patrol_hit_time": hit_time,
        "sample_patrol_paths": paths,
    }
    (output / "metrics.json").write_text(json.dumps(metrics, indent=2, ensure_ascii=False), encoding="utf-8")
    return metrics


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default="../report/figures", help="directory for figures and metrics")
    args = parser.parse_args()
    output = Path(args.output).resolve()
    metrics = make_figures(output)
    print(json.dumps(metrics, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()

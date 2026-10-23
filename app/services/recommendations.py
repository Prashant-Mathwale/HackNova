from __future__ import annotations

from typing import Any

import pandas as pd


def build_recommendations(
    frame: pd.DataFrame,
    statistics: dict[str, Any],
    anomalies: list[dict[str, Any]] | None = None,
    peak_window_start_hour: int | None = None,
    peak_window_end_hour: int | None = None,
) -> list[dict[str, Any]]:
    recommendations: list[dict[str, Any]] = []
    if statistics.get("overnight_average_power_kw") is not None and statistics.get("day_average_power_kw"):
        night = statistics["overnight_average_power_kw"]
        day = statistics["day_average_power_kw"]
        if night > day * 1.25:
            recommendations.append(
                _recommendation(
                    "review-overnight-usage",
                    "Review recurring overnight consumption",
                    f"Average power from 00:00 to 05:59 was {night:.3f} kW versus {day:.3f} kW during daytime.",
                    "Check for equipment that runs overnight and compare with your usual schedule.",
                    "medium",
                    "Historical day/night power comparison",
                    0.75,
                )
            )
    if not frame.empty:
        data = frame.copy()
        data["hour"] = data.timestamp.dt.hour
        evening = data.loc[data.hour.between(18, 22), "active_power_kw"]
        other = data.loc[~data.hour.between(18, 22), "active_power_kw"]
        if len(evening) and len(other) and evening.mean() > other.mean() * 1.2:
            recommendations.append(
                _recommendation(
                    "review-evening-peak",
                    "Review recurring evening peaks",
                    f"Mean evening power was {evening.mean():.3f} kW, compared with {other.mean():.3f} kW at other times.",
                    "Consider whether flexible activities can be shifted outside the recurring high-use period.",
                    "medium",
                    "Measured time-of-day averages",
                    0.7,
                )
            )
    if peak_window_start_hour is not None and peak_window_end_hour is not None:
        recommendations.append(
            _recommendation(
                "user-peak-window",
                "Compare flexible usage with your selected peak window",
                f"Your configured peak window is {peak_window_start_hour:02d}:00–{peak_window_end_hour:02d}:00.",
                "If your tariff or preferences make this period important, review flexible use during those hours.",
                "low",
                "User-supplied peak period",
                1.0,
            )
        )
    anomalous = [item for item in (anomalies or []) if item["is_anomaly"]]
    if len(anomalous) >= 2:
        recommendations.append(
            _recommendation(
                "review-repeated-spikes",
                "Review repeated unusual readings",
                f"The anomaly model flagged {len(anomalous)} supplied readings; this is not proof of a fault.",
                "Compare the readings with normal household activity and repeat measurements if needed.",
                "high",
                "Isolation Forest unusual-pattern flags",
                0.65,
            )
        )
    change = statistics.get("recent_vs_earlier_change_percent")
    if change is not None and change >= 20:
        recommendations.append(
            _recommendation(
                "compare-recent-usage",
                "Compare recent use with your own baseline",
                f"Mean power in the recent half of these readings was {change:.1f}% higher than the earlier half.",
                "Review changes in usage and compare the same weekdays or time periods before deciding on action.",
                "medium",
                "Recent-versus-earlier supplied-reading comparison",
                0.7,
            )
        )
    period = {
        "start": frame.timestamp.iloc[0].isoformat(),
        "end": frame.timestamp.iloc[-1].isoformat(),
    }
    for recommendation in recommendations:
        recommendation["period"] = period
    return recommendations


def _recommendation(
    recommendation_id: str,
    title: str,
    evidence: str,
    action: str,
    priority: str,
    source: str,
    confidence: float,
) -> dict[str, Any]:
    return {
        "id": recommendation_id,
        "title": title,
        "explanation": evidence,
        "evidence": evidence,
        "priority": priority,
        "suggested_action": action,
        "estimated_savings": None,
        "savings_note": "Savings are not estimated without a defensible energy and tariff basis.",
        "confidence": confidence,
        "period": None,
        "produced_by": source,
    }

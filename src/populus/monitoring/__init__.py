"""External monitoring for the published data commons (ARCHITECTURE.md §13.2).

The heartbeat monitor is a §5.5 protocol-conformant consumer that verifies the
published pointer, manifest, and stats against a durably persisted trust tuple,
and reports every observability check it makes — no state is silent or
represented as passed. The library API is :func:`populus.monitoring.monitor.run_monitor`;
the installed console entry is ``populus-monitor``.
"""

from populus.monitoring.monitor import MonitorCheck, run_monitor

__all__ = ["MonitorCheck", "run_monitor"]

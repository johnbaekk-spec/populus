"""§5.5 consumer protocol (RUN 5): fetchers + the snapshot cache client.

``populus.client.snapshot`` owns the MCP-client side of the publication
protocol — pointer state machine over the durable two-field trust tuple,
temp-verify-rename installs into ``~/.cache/populus/<module>/<build_id>/``,
and crash-consistent recovery (``reconcile``).
"""

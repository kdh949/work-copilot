"""Isolated, DLP-first work-brief generation path.

This package must not import the wiki retrieval, embedding, or persistence
helpers from ``main``.  Jira and Confluence evidence is transient request data
and is only sent to the model after this package has redacted it.
"""

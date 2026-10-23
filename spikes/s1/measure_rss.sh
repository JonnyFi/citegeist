#!/bin/sh
# Peak RSS and clean timing (models already cached). Run from spikes/s1.
PY=.venv/bin/python
/usr/bin/time -l $PY convert.py --formulas arxiv-2312.00752-mamba > out/rss_formulas.log 2>&1
/usr/bin/time -l $PY convert.py nist-ai-rmf-1.0 > out/rss_digital.log 2>&1
/usr/bin/time -l $PY convert.py scan-boehmer-palatinat-1739 > out/rss_scan.log 2>&1

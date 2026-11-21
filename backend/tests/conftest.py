"""Macht das Paket `src` für pytest importierbar (Tests laufen aus backend/)."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

"""
Roverr Business Logic Facade
=============================
This module acts as a unified facade for the modularized Roverr backend.
It re-exports all domain logic from `modules/` to guarantee 100% backward
compatibility for existing callers, background schedulers, and API endpoints.
"""

try:
    from .modules import *
    from .modules import __all__
    from . import modules
except (ImportError, ValueError):
    from modules import *
    from modules import __all__
    import modules

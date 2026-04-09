"""Solver package — CP-SAT model construction, constraints, objectives, and orchestration.

Modules
-------
model_builder  — load data, expand sections, create binary decision variables
constraints    — apply all 12 hard constraints to the CP-SAT model
objectives     — build weighted penalty objective (affinity, time pref, overload, drops)
scheduler      — orchestrate 3 solves (one per mode) and extract results
"""

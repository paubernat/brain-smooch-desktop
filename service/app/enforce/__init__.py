"""Windows enforcement layers E1-E9 (PLAN-FASE2 §4). Everything that touches the system goes
through `backend.LayerBackend`: `windows_backend.WindowsBackend` (real) or `fake.FakeBackend`
(tests)."""

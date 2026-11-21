"""Ajustes pequeños guardados como JSON en la tabla `settings`, validados con Pydantic."""

from pydantic import BaseModel, ValidationError

from app import db


def load_model[M: BaseModel](database: db.Database, key: str, model: type[M]) -> M:
    """El ajuste guardado o los valores por defecto (también si es de una versión anterior)."""
    with database.connect() as conn:
        stored = db.get_setting(conn, key)
    if not isinstance(stored, dict):
        return model()
    try:
        return model.model_validate(stored)
    except ValidationError:
        return model()


def save_model[M: BaseModel](database: db.Database, key: str, value: M) -> M:
    with database.connect() as conn:
        db.put_setting(conn, key, value.model_dump(mode="json"))
    return value

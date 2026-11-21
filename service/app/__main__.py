import uvicorn

from app.config import SERVICE_HOST, get_settings


def main() -> None:
    settings = get_settings()
    uvicorn.run("app.main:app", host=SERVICE_HOST, port=settings.service_port)


if __name__ == "__main__":
    main()

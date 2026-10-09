class ApplicationError(Exception):
    """Errores de casos de uso (no de reglas de dominio)."""


class ProjectNotFoundError(ApplicationError):
    def __init__(self, project_id: str) -> None:
        super().__init__(f"Proyecto {project_id} no encontrado")
        self.project_id = project_id


class UnsupportedFileError(ApplicationError):
    pass


class FileTooLargeError(ApplicationError):
    pass


class NoDetectorAvailableError(ApplicationError):
    pass


class AssistantUnavailableError(ApplicationError):
    """No hay asistente (sin credenciales, sin presupuesto o la API falló)."""

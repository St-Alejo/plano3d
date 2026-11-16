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


class PhotosUnavailableError(ApplicationError):
    """No se pueden generar fotos (sin clave, sin presupuesto o la API falló)."""


class InvalidPhotoRequestError(ApplicationError):
    """Las capturas enviadas no sirven (vista desconocida, archivo raro o demasiadas)."""


class InvalidRenderError(ApplicationError):
    """El render subido no sirve (vacío, demasiado grande o no es JPEG/PNG)."""


class RenderNotFoundError(ApplicationError):
    """Ese render no está en la galería del proyecto."""


# ---- cuentas (ADR-020)
class AuthError(ApplicationError):
    """Base de los errores de autenticación (la API responde 401)."""


class InvalidCredentialsError(AuthError):
    def __init__(self) -> None:
        super().__init__("Correo o contraseña incorrectos")


class InvalidTokenError(AuthError):
    def __init__(self, reason: str = "La sesión venció o no es válida") -> None:
        super().__init__(reason)


class EmailTakenError(ApplicationError):
    def __init__(self) -> None:
        super().__init__("Ya hay una cuenta con ese correo")


class WeakPasswordError(ApplicationError):
    pass


class DemoUnavailableError(ApplicationError):
    def __init__(self) -> None:
        super().__init__("La cuenta demo no está habilitada en este servidor")


# ---- compartir con otra app (ADR-024)
class ShareNotFoundError(ApplicationError):
    def __init__(self) -> None:
        super().__init__("Ese código no existe o el dueño lo revocó: pide uno nuevo en Plano 3D")


class TooManySharesError(ApplicationError):
    pass

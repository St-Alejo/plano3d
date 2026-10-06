"""Errores del dominio. Nunca dependen de infraestructura."""


class DomainError(Exception):
    """Base de toda violación de una regla de negocio."""


class InvalidGeometryError(DomainError):
    """Geometría imposible: muro de longitud cero, polígono inválido, etc."""


class OpeningDoesNotFitError(DomainError):
    """Una abertura se sale del muro o se solapa con otra."""


class EntityNotFoundError(DomainError):
    """Se referenció un muro, habitación o nivel que no existe."""


class ConcurrencyError(DomainError):
    """Otra persona guardó una versión más nueva del modelo (bloqueo optimista)."""

    def __init__(self, expected: int, actual: int) -> None:
        super().__init__(
            f"El modelo cambió mientras editabas (tu versión {expected}, actual {actual}). "
            "Recarga para ver los cambios."
        )
        self.expected = expected
        self.actual = actual


class InvalidStateTransitionError(DomainError):
    """El proyecto no puede pasar al estado pedido desde su estado actual."""

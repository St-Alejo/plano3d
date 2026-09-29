"""Errores del dominio. Nunca dependen de infraestructura."""


class DomainError(Exception):
    """Base de toda violación de una regla de negocio."""


class InvalidGeometryError(DomainError):
    """Geometría imposible: muro de longitud cero, polígono inválido, etc."""


class OpeningDoesNotFitError(DomainError):
    """Una abertura se sale del muro o se solapa con otra."""


class EntityNotFoundError(DomainError):
    """Se referenció un muro, habitación o nivel que no existe."""


class InvalidStateTransitionError(DomainError):
    """El proyecto no puede pasar al estado pedido desde su estado actual."""

/**
 * Tipos del contrato, generados desde el OpenAPI del backend (`npm run gen:api`).
 * Nunca se escriben a mano: si el backend cambia, el compilador avisa aquí.
 */
import type { components } from './schema'

type S = components['schemas']

export type BuildingModel = S['BuildingModelDTO']
export type Level = S['LevelDTO']
export type Wall = S['WallDTO']
export type Opening = S['OpeningDTO']
export type Room = S['RoomDTO']
export type Point = S['PointDTO']
export type Scale = S['ScaleDTO']
export type Project = S['ProjectDTO']
export type ProjectSummary = S['ProjectSummaryDTO']
export type ProjectStatus = S['ProjectStatus']
export type ProgressEvent = S['ProgressEventDTO']
export type OpeningKind = S['OpeningKind']

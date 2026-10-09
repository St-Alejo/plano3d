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
export type Revision = S['RevisionDTO']
export type CorrectionStats = S['CorrectionStatsDTO']
// Modelo v2 (ADR-012)
export type Measure = S['MeasureDTO']
export type MeasureStatus = S['MeasureStatus']
export type Column = S['ColumnDTO']
export type Stair = S['StairDTO']
export type Furniture = S['FurnitureDTO']
export type Dimension = S['DimensionDTO']
export type TextLabel = S['TextLabelDTO']
export type RoomType = S['RoomType']
export type WallKind = S['WallKind']
export type SolveResult = S['SolveResultDTO']
export type SolveReport = S['SolveReportDTO']
export type CaptureCheck = S['CaptureCheckDTO']
export type AssistantReply = S['AssistantReplyDTO']

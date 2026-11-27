/**
 * AURA-PALM-G5-I1 -- public surface of the shared on-device palm pipeline.
 * Input adapters (the upload picker now, the G5-I2 camera later) import
 * from here only. See AURA_PALM_G5_I1_UPLOAD_PIPELINE/05_SHARED_PIPELINE_INTERFACE.md.
 */
export * from './types';
export { createPalmAnalysisSession } from './session';
export type { PalmAnalysisSession, PalmSessionDeps, PalmSessionPhase, PalmSessionState } from './session';
export { analyzePalmFrame, PALM_ACCEPTED_HEADLINE, PALM_SCOPE_NOTE, PALM_FEEDBACK_MESSAGES } from './analyze';
export { validatePalmImageFile, PALM_IMAGE_LIMITS, PALM_UPLOAD_ACCEPT, PALM_INPUT_MESSAGES } from './validate';
export { normalizeImageBlob, normalizeDrawableFrame, createDefaultDecoder } from './normalize';
export { createMediaPipeHandDetector, PALM_MEDIAPIPE_ASSET_BASE, PALM_MEDIAPIPE_VERSION } from './mediapipeDetector';
export { isPalmImageInputEnabled, PALM_IMAGE_INPUT_FLAG, PALM_IMAGE_INPUT_FLAG_VALUE } from './gate';
// AURA-PALM-04-I1 -- in-memory construction context and headless assisted-tracing model (no UI yet).
export { analyzePalmFrameWithDetection } from './analyze';
export { PALM_CONSTRUCTION_CONTEXT_VERSION, type PalmConstructionContext, type PalmConstructionData } from './construction';
export { createTracingModel, TracingError, TRACING_LINES, MAX_TRACE_INPUT_POINTS, PALM_TRACING_MODEL_VERSION } from './tracing';
export type { TracingModel, TracingLineView, TracingLineStatus, TracingSkipReason, TracePlacement, TracingGuides, TracingErrorCode } from './tracing';
// AURA-PALM-04-I2 -- the tracing overlay's single image geometry, plus the approved line names and the I1 trace point
// limits it shows (read-only values re-exported by the geometry module; nothing is redefined).
export { PALM_TRACING_GEOMETRY_VERSION, containRect, imageToClient, clientToImage, imageDistance, spaceStroke, resampleStroke, TRACING_LINE_NAMES, TRACE_POINT_LIMITS } from './tracingGeometry';
export type { Rect as TracingRect, Pt as TracingPoint, TracingLineId, TracingUnassessedReason } from './tracingGeometry';

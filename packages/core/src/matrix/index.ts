export { exportMatrix, type MatrixExportOptions } from "./export.js";
export {
  aiTaskJobs,
  type DetachedMatrixJob,
  DetachedMatrixJobs,
  type MatrixJobContext,
  type MatrixJobQueue,
  type MatrixJobSpec,
} from "./jobs.js";
export { applyMatrixOps, parseMatrix, serializeMatrix } from "./model.js";
export { bindMatrixOperations } from "./ops.js";
export { type Passage, pageOfRange, retrievePassages } from "./passages.js";
export { type FillSummary, type MatrixDeps, MatrixService } from "./service.js";

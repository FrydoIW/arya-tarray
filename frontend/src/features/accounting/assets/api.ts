import { apiFetch } from '@/lib/api';
import type { Approval } from '../core/types';
import type { AssetInput, AssetRow, Category, CategoryInput, ChangeInput, ChangeResult, DraftSource, RunDetail, RunInput, RunPreview, SourcePath } from './types';

function write<T>(path: string, body: unknown, method: 'POST' | 'PATCH' = 'POST') {
  return apiFetch<T>('/accounting/' + path, { method, body: JSON.stringify(body) });
}
export const saveCategory = (input: CategoryInput, current?: Category) => current
  ? write<Category>('asset-categories/' + current.id, { ...input, expectedRevision: current.revision }, 'PATCH')
  : write<Category>('asset-categories', input);
export const saveAsset = (input: AssetInput, current?: DraftSource) => current
  ? write<AssetRow>('assets/' + current.id, { ...input, expectedRevision: current.revision }, 'PATCH')
  : write<AssetRow>('assets', input);
export const createChange = (id: string, input: ChangeInput) => write<ChangeResult>('assets/' + id + '/changes', input);
export const previewRun = (input: RunInput) => write<RunPreview>('depreciation-runs/preview', input);
export const createRun = (input: RunInput) => write<RunDetail>('depreciation-runs', input);
export const submitAssetSource = (path: SourcePath, source: DraftSource) =>
  write<Approval>(path + '/' + source.id + '/submit', { expectedRevision: source.revision });
export const refreshAssetSource = (path: Exclude<SourcePath, 'assets'>, source: DraftSource) =>
  write<DraftSource>(path + '/' + source.id + '/refresh', { expectedRevision: source.revision });
export const cancelAssetSource = (path: SourcePath, source: DraftSource, reason: string) =>
  write<unknown>(path + '/' + source.id + '/cancel', { expectedRevision: source.revision, reason });
export const applyAssetApproval = (path: SourcePath, sourceId: string, approvalRequestId: string) =>
  write<unknown>(path + '/' + sourceId + (path === 'assets' ? '/activate' : '/post'), { approvalRequestId });

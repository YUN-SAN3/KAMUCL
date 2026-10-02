import { getVersionCatalog } from './api'
import { createCatalogSession } from '@shared/catalogSession'
export const catalogSession = createCatalogSession(getVersionCatalog)

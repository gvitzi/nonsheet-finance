/** URL helpers for portfolio → asset group navigation. */

export function portfolioPath(portfolioId: string) {
  return `/portfolios/${portfolioId}`
}

export function assetGroupHubPath(portfolioId: string, assetGroupId: string) {
  return `/portfolios/${portfolioId}/asset-groups/${assetGroupId}`
}

export function assetGroupEditPath(portfolioId: string, assetGroupId: string) {
  return `/portfolios/${portfolioId}/asset-groups/${assetGroupId}/edit`
}

export function assetGroupNewPath(portfolioId: string) {
  return `/portfolios/${portfolioId}/asset-groups/new`
}

export function assetGroupAssetPath(portfolioId: string, assetGroupId: string, assetId: string) {
  return `/portfolios/${portfolioId}/asset-groups/${assetGroupId}/assets/${assetId}`
}

export function assetGroupPropertyPath(portfolioId: string, assetGroupId: string, propertyId: string) {
  return `/portfolios/${portfolioId}/asset-groups/${assetGroupId}/properties/${propertyId}`
}

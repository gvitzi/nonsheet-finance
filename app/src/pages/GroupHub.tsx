import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { api } from '../api'
import type { AssetGroup } from '../api'
import GroupHubGeneric from './GroupHubGeneric'
import RealEstateAggregate from './RealEstateAggregate'
import RealEstatePropertyView from './RealEstatePropertyView'
import SecuritiesGroupHub from './SecuritiesGroupHub'
import GeneralAssetView from './GeneralAssetView'

export default function GroupHub() {
  const { portfolioId, assetGroupId, propertyId, assetId } = useParams<{
    portfolioId: string
    assetGroupId: string
    propertyId?: string
    assetId?: string
  }>()
  const [assetGroup, setAssetGroup] = useState<AssetGroup | null>(null)
  const [loading, setLoading] = useState(true)
  const [pageError, setPageError] = useState<string | null>(null)

  const loadAssetGroup = useCallback(() => {
    if (!assetGroupId) return Promise.resolve()
    return api.assetGroups.get(assetGroupId).then(setAssetGroup)
  }, [assetGroupId])

  useEffect(() => {
    if (!assetGroupId) return
    setLoading(true)
    setPageError(null)
    loadAssetGroup()
      .catch(() => setPageError('This Asset Group could not be loaded.'))
      .finally(() => setLoading(false))
  }, [assetGroupId, loadAssetGroup])

  if (!portfolioId || !assetGroupId) return <div className="page-error">Missing portfolio or Asset Group.</div>
  if (loading) return <div className="page-loading">Loading Asset Group…</div>
  if (pageError || !assetGroup) return <div className="page-error">{pageError ?? 'Asset group not found.'}</div>

  if (assetGroup.portfolioId !== portfolioId) {
    return <div className="page-error">This Asset Group does not belong to the portfolio in the URL.</div>
  }

  if (assetGroup.kind === 'real_estate' && propertyId) {
    return (
      <RealEstatePropertyView
        portfolioId={portfolioId}
        assetGroupId={assetGroupId}
        propertyId={propertyId}
        groupName={assetGroup.name}
      />
    )
  }

  if (assetGroup.kind === 'real_estate') {
    return <RealEstateAggregate group={assetGroup} portfolioId={portfolioId} assetGroupId={assetGroupId} />
  }

  if (assetGroup.kind === 'investments') {
    return <SecuritiesGroupHub group={assetGroup} portfolioId={portfolioId} assetGroupId={assetGroupId} />
  }

  if (assetGroup.kind === 'general' && assetId) {
    return (
      <GeneralAssetView portfolioId={portfolioId} assetGroupId={assetGroupId} assetId={assetId} groupName={assetGroup.name} />
    )
  }

  return <GroupHubGeneric group={assetGroup} portfolioId={portfolioId} assetGroupId={assetGroupId} />
}

export const dicomViewerUrl = (viewer: string, publicRoot: string, token: string, studyUids: string[]) => {
  const url = new URL(viewer)
  if (url.pathname === '/') url.pathname = '/viewer'
  url.searchParams.set('StudyInstanceUIDs', studyUids.join(','))
  url.searchParams.set('configUrl', `${publicRoot.replace(/\/$/, '')}/dicom-viewer/${token}/config`)
  return url.toString()
}

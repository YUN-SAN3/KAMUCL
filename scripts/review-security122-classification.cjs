// Rebind previously reviewed value/context decisions to a new sanitized coverage receipt.
// Unknown values remain pending; a fixture path alone does not exonerate a candidate.
const fs = require('node:fs'), crypto = require('node:crypto')
const coveragePath = 'audit-reports/SECURITY_SCAN_COVERAGE.json', reviewPath = 'audit-reports/SECURITY_REVIEW_CLASSIFICATION.json'
const bytes = fs.readFileSync(coveragePath), source = JSON.parse(bytes), previous = JSON.parse(fs.readFileSync(reviewPath, 'utf8'))
const reviewed = new Map(previous.scopes.flatMap(scope => scope.decisions.map(row => [JSON.stringify([scope.scope, row.kind, row.fingerprint, row.location]), row])))
const scopes = [{ scope: 'current', findings: source.current.findings }, { scope: 'history', findings: source.history.findings }, ...source.artifacts.map(row => ({ scope: row.coverage.label, findings: row.findings }))].map(({ scope, findings }) => {
  const decisions = findings.map(finding => {
    const earlier = reviewed.get(JSON.stringify([scope, finding.kind, finding.fingerprint, finding.location]))
    const decision = finding.classification === 'public-identifier-not-a-secret'
      ? { status: 'public-identifier', reason: 'Public application identity; ownership/permission remains separate Client ID audit.' }
      : earlier ? { status: earlier.status, reason: earlier.reason } : { status: 'pending-context-review', reason: 'New value/context requires explicit manual review; no secret value is disclosed.' }
    return { ...finding, ...decision }
  })
  return { scope, candidateCount: decisions.length, decisions }
})
const unknownCandidates = scopes.reduce((sum, scope) => sum + scope.decisions.filter(row => row.status === 'pending-context-review').length, 0)
const receipt = { schema: 1, generatedAtUTC: new Date().toISOString(), scannerCoverageSHA256: crypto.createHash('sha256').update(bytes).digest('hex'),
  valueDisclosure: false, claims: { confirmedPrivateCredentialLeakFound: false, unknownCandidates, fullAbsenceProven: false, CFApplicationOwnershipVerified: false },
  reviewSemantics: 'Retains prior manual value/context decisions only for the same scope, kind, value fingerprint and source location, rebinding line offsets to this receipt. New values or locations stay pending; fixture location does not independently prove safety.', scopes }
fs.writeFileSync(reviewPath, JSON.stringify(receipt, null, 2) + '\n')
console.log(JSON.stringify({ output: reviewPath, unknownCandidates, scopes: scopes.map(scope => ({ scope: scope.scope, candidates: scope.candidateCount, classifications: scope.decisions.reduce((counts, row) => (counts[row.status] = (counts[row.status] || 0) + 1, counts), {}) })) }))
if (unknownCandidates) process.exitCode = 1

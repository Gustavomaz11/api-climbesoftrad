import { demographicDifferences, type PatientDemographics } from './patient-identity.policy'
export const initialPatientIdentification = (
  known: PatientDemographics | null,
  incoming: PatientDemographics,
  reliable?: boolean,
) => {
  const differences = known ? demographicDifferences(known, incoming) : []
  const status: 'IDENTIFIED' | 'UNIDENTIFIED' | 'CONFLICT' =
    differences.length || reliable === false ? 'CONFLICT' : known ? 'IDENTIFIED' : 'UNIDENTIFIED'
  return { status, differences }
}

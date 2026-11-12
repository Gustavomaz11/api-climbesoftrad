import type { MigrationInterface, QueryRunner } from 'typeorm'

export class RejectedPatientReviewState1910000000000 implements MigrationInterface {
  name = 'RejectedPatientReviewState1910000000000'

  async up(runner: QueryRunner) {
    await runner.query(`WITH candidates AS (
      SELECT e.id,e.patient_identity_status AS previous_status,r.id AS review_id,
        a.id AS decision_event_id,a.actor_user_id,a.session_id,a.correlation_id,
        CASE WHEN EXISTS(SELECT 1 FROM patient_identifiers i WHERE i.id=e.patient_identifier_id
          AND i.company_id=e.company_id AND i.patient_id=e.patient_id AND i.unit_id=e.unit_id AND i.reliable
        ) THEN 'IDENTIFIED' ELSE 'UNIDENTIFIED' END AS next_status
      FROM exams e
      JOIN LATERAL (
        SELECT current.* FROM patient_reviews current WHERE current.company_id=e.company_id
          AND current.patient_id=e.patient_id AND current.unit_id=e.unit_id
          AND current.kind IN ('CONFLICT','SUGGESTION') ORDER BY current.updated_at DESC,current.id LIMIT 1
      ) r ON r.status='REJECTED' AND e.created_at<=r.updated_at
      JOIN LATERAL (
        SELECT event.* FROM operational_events event WHERE event.company_id=e.company_id
          AND event.action='PATIENT_MATCH_REJECTED' AND event.outcome='SUCCEEDED'
          AND event.metadata->>'reviewId'=r.id::text ORDER BY event.occurred_at DESC LIMIT 1
      ) a ON true
      WHERE e.patient_identity_status IN ('CONFLICT','SUGGESTION') AND NOT EXISTS(
        SELECT 1 FROM patient_reviews pending WHERE pending.company_id=e.company_id
          AND pending.patient_id=e.patient_id AND pending.unit_id=e.unit_id AND pending.status='OPEN'
          AND pending.kind IN ('CONFLICT','SUGGESTION')
      )
    ), changed AS (
      UPDATE exams e SET patient_identity_status=c.next_status,updated_at=now()
      FROM candidates c WHERE e.id=c.id
      RETURNING e.id,e.company_id,e.unit_id,c.review_id,c.decision_event_id,c.actor_user_id,
        c.session_id,c.correlation_id,c.previous_status,c.next_status
    )
    INSERT INTO operational_events(company_id,unit_id,actor_user_id,session_id,correlation_id,action,
      resource_type,resource_id,outcome,reason,metadata,completed_at)
    SELECT company_id,unit_id,actor_user_id,session_id,correlation_id,'PATIENT_MATCH_REJECTED',
      'exam',id,'SUCCEEDED','Conciliação do estado do exame após decisão de manter cadastros separados.',
      jsonb_build_object('reviewId',review_id,'decisionEventId',decision_event_id,
        'previousStatus',previous_status,'nextStatus',next_status,'origin','MIGRATION'),now()
    FROM changed`)
  }

  down(): Promise<void> {
    return Promise.reject(new Error(
      'A conciliação preserva decisões já registradas. Restaure estados anteriores somente com revisão do histórico.',
    ))
  }
}

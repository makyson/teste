CREATE CONSTRAINT company_id_unique IF NOT EXISTS
FOR (c:Company)
REQUIRE c.id IS UNIQUE;

CREATE CONSTRAINT site_id_unique IF NOT EXISTS
FOR (s:Site)
REQUIRE s.id IS UNIQUE;

CREATE CONSTRAINT device_id_unique IF NOT EXISTS
FOR (d:LogicalDevice)
REQUIRE d.id IS UNIQUE;

CREATE INDEX daily_metric_day_index IF NOT EXISTS
FOR (m:DailyMetric)
ON (m.day);

CREATE CONSTRAINT rule_id_unique IF NOT EXISTS
FOR (r:Rule)
REQUIRE r.id IS UNIQUE;

CREATE CONSTRAINT alert_id_unique IF NOT EXISTS
FOR (a:Alert)
REQUIRE a.id IS UNIQUE;

CREATE CONSTRAINT nlq_question_identity_unique IF NOT EXISTS
FOR (q:NlqQuestion)
REQUIRE (q.companyKey, q.normalizedText) IS UNIQUE;

MERGE (c:Company {id: 'company-1'})
ON CREATE SET c.name = 'Empresa Demo'
RETURN c;

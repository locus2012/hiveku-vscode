// Imported first by a test that must run in a US time zone. A module's imports are evaluated before its
// own code, so setting the zone here, rather than in the test, sets it before anything else loads.
process.env.TZ = 'America/Chicago';

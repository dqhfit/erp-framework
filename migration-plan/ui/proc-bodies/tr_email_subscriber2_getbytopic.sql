-- PARAMS:
-- @topic nvarchar

CREATE PROCEDURE TR_EMAIL_SUBSCRIBER2_GETBYTOPIC(@topic nvarchar(50))
AS
SELECT * FROM tr_email_subscriber2
WHERE topic = @topic

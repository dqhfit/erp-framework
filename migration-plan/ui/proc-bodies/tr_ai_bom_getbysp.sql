-- PARAMS:
-- @masp nvarchar

CREATE PROC TR_AI_BOM_GETBYSP(@masp nvarchar(100))
AS
DECLARE @AI_CODE NVARCHAR(50)

SELECT @AI_CODE = id_ai
FROM tr_ai_code
WHERE masp = @masp


SELECT * FROM tr_ai_bom
WHERE id_ai = @AI_CODE

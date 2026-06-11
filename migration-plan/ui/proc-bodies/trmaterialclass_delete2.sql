-- PARAMS:
-- @Key nvarchar


CREATE PROC [dbo].[TRMATERIALCLASS_DELETE2](@Key NVARCHAR(200))
AS
--DECLARE @Key NVARCHAR(200) = N'GVE';
WITH rCTE AS(
    SELECT *, 0 AS Level FROM trmaterialclass WHERE code = @Key
    UNION ALL
    SELECT t.*, r.Level + 1 AS Level
    FROM trmaterialclass t
    INNER JOIN rCTE r
        ON t.p_id = r.code
)

SELECT * 
INTO #TEMP
FROM rCTE OPTION(MAXRECURSION 0)

--DELETE trmaterialclass
--WHERE id IN (SELECT id FROM #TEMP);

UPDATE trmaterialclass
SET active = 0
WHERE id IN (SELECT id FROM #TEMP);

--DELETE trmaterialstddetails
--WHERE idclass IN (SELECT code FROM #TEMP);



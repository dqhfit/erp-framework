-- PARAMS:
-- @FILTER nvarchar

CREATE PROC TR_ORDER_GETBYSTATUS (@FILTER NVARCHAR (50))
AS
IF @FILTER = 'FINISH'
   BEGIN
      SELECT *
      FROM tr_order A
      WHERE A.f_cancelled = 'N' AND A.choduyet = 1 AND A.Finished = 1
   END

IF @FILTER = 'NOT'
   BEGIN
      SELECT *
      FROM tr_order A
      WHERE A.f_cancelled = 'N' AND A.choduyet = 1 AND A.Finished = 0
   END


IF @FILTER = 'ALL'
   BEGIN
      SELECT *
      FROM tr_order A
      WHERE A.f_cancelled = 'N' AND A.choduyet = 1
   END

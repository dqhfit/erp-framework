-- PARAMS:
-- @phanloai nvarchar

CREATE PROC TR_BANVE_GETBYTYPE(@phanloai NVARCHAR(50))
AS
BEGIN
	SELECT * FROM tr_banve
	WHERE active = 1 AND phanloai = @phanloai
END



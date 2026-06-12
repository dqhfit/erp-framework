-- PARAMS:
-- @IsFinish bit

CREATE   PROCEDURE [dbo].[TR_PHIEUYEUCAU_GETALL3] (@IsFinish BIT)
AS
BEGIN
	SELECT A.id, A.sophieu, 
		A.makho, D.[description] AS tenkho,
		A.bophan, C.tenbophan,
		A.nguoitao, B.FullName as nguoidexuat,
		A.ngaytao
	FROM tr_phieuyeucau A
		INNER JOIN SYS_USER B ON A.nguoitao = B.UserName
		INNER JOIN tr_bophan C ON A.bophan = C.mabophan
		INNER JOIN tr_site D ON A.makho = D.[name]
	WHERE A.active = 1
		AND A.IsSend = 1
		AND A.IsConfirm = 1
		AND A.IsFinish = @IsFinish
		AND (BGD_CANCEL IS NULL OR BGD_CANCEL = 0)
	ORDER BY A.ngaytao
END

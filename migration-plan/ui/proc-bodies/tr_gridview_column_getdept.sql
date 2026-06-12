-- PARAMS:
-- (khong co tham so)


CREATE PROC TR_GRIDVIEW_COLUMN_GETDEPT
AS
BEGIN
	SELECT DISTINCT B.* 
	FROM tr_gridview_column A
		INNER JOIN tr_bophan B ON A.mabophan = B.mabophan
	WHERE A.formName = 'frmKeHoachSanXuatPO2'
	ORDER BY B.stt
END


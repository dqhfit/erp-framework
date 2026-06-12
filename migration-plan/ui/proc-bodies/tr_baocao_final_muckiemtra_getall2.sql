-- PARAMS:
-- @report_id uniqueidentifier


CREATE PROC [dbo].[TR_BAOCAO_FINAL_MUCKIEMTRA_GETALL2](@report_id uniqueidentifier)
AS
BEGIN
	SELECT A.item_id, A.stt, A.masp, A.tensp, A.diengiai, A.soluong_kiemtra, A.danhgia, A.hanhdong, A.ghichu,
		B.image_path, B.image_name, B.image_id
	FROM tr_baocao_final_muckiemtra A
		LEFT JOIN tr_baocao_final_hinhanh B ON A.item_id = B.item_id
	WHERE A.report_id = @report_id
END


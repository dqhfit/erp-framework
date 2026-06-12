-- PARAMS:
-- @trangthai nvarchar


CREATE PROCEDURE TR_PHIEUGIAO_THANHPHAM_GETBYSTATUS
(
	@trangthai nvarchar(max)
)
AS
BEGIN
	SELECT A.*, B.RefTypeName AS trangthai
	FROM tr_phieugiao_thanhpham A
		LEFT JOIN tr_reftype B ON A.reftype_id = B.RefType
	WHERE A.reftype_id IN (SELECT LTRIM(RTRIM([value])) FROM string_split(@trangthai, ','))
END


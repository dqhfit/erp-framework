-- PARAMS:
-- @masp nvarchar


CREATE   PROC [dbo].[MES_QUYTRINH_SANPHAM_GETALL2](@masp nvarchar(200))
AS
SELECT A.*, B.n_op, OP.n_op AS n_op2, C.tenkhuvuc
FROM mes_quytrinh_sanpham A
	LEFT JOIN trtb_m_op B ON A.quytrinh = B.c_op
	LEFT JOIN tr_khuvuc_sanxuat C ON B.department = C.makhuvuc
	LEFT JOIN trtb_m_op OP ON A.quytrinh2 = OP.c_op
WHERE A.masp = @masp AND A.active = 1
	AND LEN(quytrinh) > 0
ORDER BY A.stt, A.buoc


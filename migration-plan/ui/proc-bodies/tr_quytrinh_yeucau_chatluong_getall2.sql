-- PARAMS:
-- (khong co tham so)


CREATE   PROCEDURE [dbo].[TR_QUYTRINH_YEUCAU_CHATLUONG_GETALL2]
AS
BEGIN
	SELECT A.*, B.n_op AS tencongdoan 
	FROM tr_quytrinh_yeucau_chatluong  A
		INNER JOIN trtb_m_op B ON A.macongdoan = B.c_op
	WHERE A.active = 1
END


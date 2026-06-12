-- PARAMS:
-- @donhang nvarchar


CREATE PROCEDURE TR_PROFORMA_INVOICE_GETALL2(@donhang nvarchar(50))
AS
BEGIN
	SELECT A.*, B.destination_name 
	FROM tr_proforma_invoice A
		LEFT JOIN tr_list_destination B ON A.cangden = B.destination_code
	WHERE A.active = 1 AND A.donhang = @donhang
END


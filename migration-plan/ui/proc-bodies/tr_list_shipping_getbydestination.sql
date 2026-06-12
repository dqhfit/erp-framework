-- PARAMS:
-- @DestinationCode nvarchar


CREATE PROC [dbo].[TR_LIST_SHIPPING_GETBYDESTINATION](@DestinationCode NVARCHAR(50))
AS
SELECT * 
FROM tr_list_shipping WITH(NOLOCK)
WHERE active = 1
    AND destination_code = @DestinationCode

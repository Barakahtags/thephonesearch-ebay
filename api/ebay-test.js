// ThePhoneSearch production eBay API connection test
module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const token = process.env.EBAY_USER_TOKEN;
  if (!token) {
    return res.status(500).json({ ok: false, error: 'EBAY_USER_TOKEN is not configured' });
  }

  try {
    const ebayResponse = await fetch('https://api.ebay.com/sell/account/v1/privilege/', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'Content-Type': 'application/json'
      }
    });

    const text = await ebayResponse.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }

    if (!ebayResponse.ok) {
      return res.status(ebayResponse.status).json({
        ok: false,
        ebayStatus: ebayResponse.status,
        ebayResponse: data
      });
    }

    return res.status(200).json({
      ok: true,
      message: 'Production eBay OAuth connection is working.',
      privileges: data
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
};

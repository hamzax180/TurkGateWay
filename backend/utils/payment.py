import os
import iyzipay
import uuid
from typing import Dict, Any

class IyzicoPayment:
    def __init__(self):
        self.options = {
            'api_key': os.getenv('IYZICO_API_KEY'),
            'secret_key': os.getenv('IYZICO_SECRET_KEY'),
            'base_url': os.getenv('IYZICO_BASE_URL')
        }

    def _get_api_client(self):
        # iyzipay library uses these options for its requests
        return self.options

    def initialize_subscription_checkout_form(self, 
                                            user_email: str, 
                                            user_id: str, 
                                            pricing_plan_code: str, 
                                            callback_url: str,
                                            language: str = 'tr') -> Dict[str, Any]:
        """
        Initializes the iyzico v2 Subscription Checkout Form.
        Ref: https://dev.iyzipco.com/docs/subscription-checkout-form
        """
        
        # Note: As of latest iyzipay-python, v2 subscription might require direct HttpClient call 
        # for signature if the specific resource isn't in the SDK yet.
        # However, we'll try to use the library's internal logic for auth headers.
        
        request = {
            'locale': 'tr' if language == 'tr' else 'en',
            'conversationId': str(uuid.uuid4()),
            'callbackUrl': callback_url,
            'pricingPlanReferenceCode': pricing_plan_code,
            'subscriptionInitialStatus': 'ACTIVE', # Auto-activate upon payment
            'customer': {
                'name': user_email.split('@')[0],
                'surname': 'User',
                'email': user_email,
                'gsmNumber': '+905000000000',
                'identityNumber': '11111111111',
                'shippingAddress': {
                    'contactName': user_email.split('@')[0],
                    'city': 'Istanbul',
                    'country': 'Turkey',
                    'address': 'Nispetiye Cad. No:1',
                    'zipCode': '34340'
                },
                'billingAddress': {
                    'contactName': user_email.split('@')[0],
                    'city': 'Istanbul',
                    'country': 'Turkey',
                    'address': 'Nispetiye Cad. No:1',
                    'zipCode': '34340'
                }
            }
        }

        # v2 subscription endpoints are not standard v1.
        # We use iyzipay.HttpClient and specialized IYZWSv2 auth.
        
        # For this implementation, we will use a raw request wrapper that handles the IYZWSv2 
        # signature if the SDK is behind, or use the SDK if available.
        # The iyzipay-python library version 1.0.46 usually requires a manual v2 call helper.
        
        return self._make_v2_request('/v2/subscription/checkoutform/initialize', request)

    def _make_v2_request(self, endpoint: str, request_body: Dict[str, Any]) -> Dict[str, Any]:
        """
        Makes a signature-compliant V2 request to iyzico.
        """
        import json
        import httpx
        import base64
        import hmac
        import hashlib
        from datetime import datetime

        url = f"{self.options['base_url']}{endpoint}"
        api_key = self.options['api_key']
        secret_key = self.options['secret_key']
        
        # IYZWSv2 auth logic
        random_str = str(uuid.uuid4())
        payload = json.dumps(request_body)
        
        # Signature = api_key + random_str + secret_key + payload
        signature_raw = f"{api_key}{random_str}{secret_key}{payload}"
        signature = hmac.new(
            secret_key.encode('utf-8'),
            signature_raw.encode('utf-8'),
            hashlib.sha256
        ).hexdigest()
        
        authorization = base64.b64encode(
            f"IYZWSv2 {api_key}:{signature}".encode('utf-8')
        ).decode('utf-8')

        headers = {
            'Authorization': f"IYZWSv2 {authorization}",
            'x-iyzi-rnd': random_str,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        }

        with httpx.Client() as client:
            response = client.post(url, headers=headers, content=payload)
            return response.json()

    def get_subscription_result(self, token: str) -> Dict[str, Any]:
        """
        Queries the result of a checkout form flow using the token.
        """
        return self._make_v2_request(f'/v2/subscription/checkoutform/result/token/{token}', {})

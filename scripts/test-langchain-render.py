import os
import sys
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage, SystemMessage

# Live Render proxy configuration
BASE_URL = os.getenv("FREELLM_BASE_URL", "https://my-freellmapi-proxy.onrender.com/v1")
API_KEY = os.getenv("FREELLM_API_KEY", "freellmapi-6c693465337e36eae695139f44da8dec2ae5f10389be9471")

print(f"Connecting LangChain to Render proxy: {BASE_URL}")

llm = ChatOpenAI(
    model="auto",
    base_url=BASE_URL,
    api_key=API_KEY,
    temperature=0.7,
    request_timeout=60,
    max_tokens=60,
)

try:
    print("Sending prompt via LangChain ChatOpenAI...")
    response = llm.invoke([
        SystemMessage(content="You are a helpful assistant."),
        HumanMessage(content="Reply with: 'LangChain is live and connected to your Render proxy!'"),
    ])
    print("\n---------------- SUCCESS ----------------")
    print("Response from FreeLLMAPI via LangChain:")
    print(response.content)
    print("-----------------------------------------\n")
except Exception as e:
    print(f"\nError connecting LangChain: {e}")
    sys.exit(1)

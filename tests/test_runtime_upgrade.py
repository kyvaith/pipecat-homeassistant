"""Runtime contracts that must survive Pipecat upgrades."""

from __future__ import annotations

import asyncio
import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

sys.path.insert(
    0, str(Path(__file__).resolve().parents[1] / "addons" / "pipecat_assist")
)

from app.config import (
    ConfigStore,
    FlowConfig,
    IntegrationConfig,
    PipelineStepConfig,
    RuntimeConfig,
)
from app.main import (
    _aws_nova_sonic_service,
    _build_llm_service,
    _build_stt_service,
    _build_tts_service,
    _composed_user_params,
    _deepgram_flux_transcribe_stream,
    _flow_global_functions,
    _flow_node_configs,
    _flow_with_mcp_context,
    _gemini_generate_content,
    _gemini_live_service,
    _openai_realtime_service,
    _queue_stream_audio,
    _rtvi_observer_params,
    _runtime_flow_errors,
    _static_models_for,
    _step_model_for,
    run_bot,
)
from app.mcp_bridge import (
    MCP_CALL_HISTORY,
    MCP_TOOLS_SCHEMA_CACHE,
    CombinedMCPBridge,
    HomeAssistantMCPBridge,
    RecordingMCPClient,
)
from app.speechmatics_legacy import SpeechmaticsRealtimeSTTService
from app.text_agent import run_text_conversation
from mcp.client.session_group import StreamableHttpParameters
from pipecat.adapters.llm.schemas.function_schema import FunctionSchema
from pipecat.adapters.llm.schemas.tools_schema import ToolsSchema
from pipecat.flows import FlowsFunctionSchema
from pipecat.services.deepgram.flux.stt import DeepgramFluxSTTService
from pipecat.turns.user_stop import (
    SpeechTimeoutUserTurnStopStrategy,
    TurnAnalyzerUserTurnStopStrategy,
)
from pipecat.turns.user_turn_strategies import ExternalUserTurnStrategies


def composed(kind="openai_cloud", role="llm", **fields):
    integration = IntegrationConfig(
        id="test-provider",
        name="Test",
        kind=kind,
        api_key="test-key",
        enabled=True,
        **fields,
    )
    flow = FlowConfig(
        mode="composed",
        provider_id=integration.id,
        steps=[
            PipelineStepConfig(
                id=role, kind=role, label=role, integration_id=integration.id
            )
        ],
    )
    return RuntimeConfig(integrations=[integration], flows=[flow]), flow, integration


class ServiceConstructionTests(unittest.IsolatedAsyncioTestCase):
    async def test_other_realtime_providers_construct(self):
        flow = FlowConfig(voice="alloy")
        integration = IntegrationConfig(
            id="openai", name="OpenAI", kind="openai", api_key="test"
        )
        service = _openai_realtime_service(
            api_key="test",
            model="gpt-realtime",
            flow=flow,
            integration=integration,
            tools_schema=None,
        )
        await service.cleanup()
        integration = IntegrationConfig(
            id="aws",
            name="AWS",
            kind="aws_nova_sonic",
            access_key_id="test",
            secret_key="test",
        )
        flow.voice = "tiffany"
        service = _aws_nova_sonic_service(
            integration=integration,
            flow=flow,
            model="amazon.nova-sonic-v1:0",
            tools_schema=None,
        )
        await service.cleanup()

    async def test_google_tts_services_construct_with_saved_speed(self):
        from google.auth.credentials import AnonymousCredentials

        for kind in ("google_cloud_tts", "google_streaming_tts"):
            config, flow, _ = composed(kind, "tts", credentials_json="{}", speed=1.2)
            with patch(
                "pipecat.services.google.tts.service_account.Credentials.from_service_account_info",
                return_value=AnonymousCredentials(),
            ):
                service = _build_tts_service(config, flow)
            self.assertEqual(service._settings.speaking_rate, 1.2)
            await service.cleanup()

    async def test_speechmatics_models_use_their_own_api(self):
        for model, expected in (
            ("enhanced", SpeechmaticsRealtimeSTTService),
            ("linden-1", None),
        ):
            config, flow, _ = composed("speechmatics", "stt", default_model=model)
            service = _build_stt_service(config, flow)
            if expected:
                self.assertIsInstance(service, expected)
            else:
                self.assertNotIsInstance(service, SpeechmaticsRealtimeSTTService)
                self.assertEqual(service._settings.model, "linden-1")
            await service.cleanup()

    async def test_composed_llm_providers_construct_on_current_pipecat(self):
        for kind in (
            "openai_cloud",
            "gemini_cloud",
            "openai_compatible",
            "ollama",
            "aws_bedrock",
            "anthropic",
            "azure_openai",
        ):
            with self.subTest(kind=kind):
                config, flow, _integration = composed(
                    kind,
                    default_model="test-model",
                    access_key_id="test",
                    secret_key="test",
                    endpoint="https://test.openai.azure.com",
                    deployment="test-deployment",
                )
                service = _build_llm_service(config, flow)
                self.assertIsNotNone(service)
                await service.cleanup()

    async def test_provider_turn_mode_reaches_the_stt_service(self):
        config, flow, _ = composed("soniox", "stt", language="pl")
        soniox = _build_stt_service(config, flow)
        self.assertFalse(soniox._vad_force_turn_endpoint)
        self.assertEqual(soniox._settings.language_hints, ["pl"])
        await soniox.cleanup()
        config, flow, _ = composed("gradium", "stt", language="pl")
        gradium = _build_stt_service(config, flow)
        self.assertTrue(gradium._enable_turn_detection)
        self.assertEqual(gradium._settings.language, "pl")
        await gradium.cleanup()
        flow.steps.insert(0, PipelineStepConfig(id="vad", kind="vad", label="Turn"))
        gradium = _build_stt_service(config, flow)
        self.assertFalse(gradium._enable_turn_detection)
        await gradium.cleanup()

    async def test_composed_stt_providers_construct(self):
        for kind in ("openai_cloud", "soniox", "deepgram", "speechmatics", "gradium"):
            with self.subTest(kind=kind):
                config, flow, _ = composed(kind, "stt")
                service = _build_stt_service(config, flow)
                self.assertIsNotNone(service)
                await service.cleanup()

    async def test_composed_tts_providers_construct(self):
        for kind in ("openai_cloud", "soniox", "cartesia", "elevenlabs", "gradium"):
            with self.subTest(kind=kind):
                config, flow, _ = composed(kind, "tts")
                service = _build_tts_service(config, flow)
                self.assertIsNotNone(service)
                await service.cleanup()

    async def test_gemini_realtime_constructs_with_saved_voice_and_language(self):
        flow = FlowConfig()
        integration = IntegrationConfig(
            id="gemini", name="Gemini", kind="gemini", language="pl"
        )
        service = _gemini_live_service(
            api_key="test",
            model=flow.model,
            flow=flow,
            integration=integration,
            local_turn_detection=True,
        )
        self.assertEqual(service._settings.voice, "Charon")
        self.assertEqual(service._settings.language, "pl")
        await service.cleanup()

    async def test_custom_openai_llm_uses_local_url_and_not_global_key(self):
        config, flow, integration = composed(base_url="http://local-ai:8000/v1")
        config.openai_api_key = "cloud-key-must-not-leak"
        integration.api_key = ""
        service = _build_llm_service(config, flow)
        self.assertEqual(str(service._client.base_url), "http://local-ai:8000/v1/")
        self.assertEqual(service._client.api_key, "not-needed")
        await service.cleanup()

    async def test_deepgram_flux_is_a_distinct_streaming_service(self):
        config, flow, _ = composed("deepgram", "stt", default_model="flux-general-en")
        service = _build_stt_service(config, flow)
        self.assertIsInstance(service, DeepgramFluxSTTService)
        self.assertIsInstance(
            _composed_user_params(flow, service).user_turn_strategies,
            ExternalUserTurnStrategies,
        )
        await service.cleanup()

    async def test_ha_conversation_custom_openai_uses_the_same_endpoint(self):
        config, flow, integration = composed(base_url="http://local-ai:8000/v1")
        integration.api_key = ""
        flow.mcp_enabled = False
        config.openai_api_key = "cloud-key-must-not-leak"
        message = SimpleNamespace(
            content="Hello",
            tool_calls=[],
            model_dump=lambda **kw: {"role": "assistant", "content": "Hello"},
        )
        client = AsyncMock()
        client.chat.completions.create.return_value = SimpleNamespace(
            choices=[SimpleNamespace(message=message)]
        )
        with patch("app.text_agent.AsyncOpenAI", return_value=client) as factory:
            result = await run_text_conversation(
                config, text="Hi", flow_id=flow.id, language="en", conversation_id=None
            )
        self.assertEqual(factory.call_args.kwargs["base_url"], integration.base_url)
        self.assertEqual(factory.call_args.kwargs["api_key"], "not-needed")
        self.assertEqual(result["speech"], "Hello")


class TurnAndFlowTests(unittest.TestCase):
    def test_rtvi_upgrade_keeps_one_caption_source_for_legacy_cards(self):
        params = _rtvi_observer_params(speech_to_speech=True)
        self.assertFalse(params.user_input_enabled)
        self.assertFalse(params.user_llm_enabled)
        self.assertTrue(params.user_transcription_enabled)
        self.assertFalse(params.bot_output_enabled)
        self.assertFalse(params.bot_tts_enabled)
        self.assertTrue(params.bot_llm_enabled)
        self.assertTrue(_rtvi_observer_params().bot_output_enabled)

    def test_custom_openai_model_survives_saved_config_migration(self):
        integration = IntegrationConfig(
            id="openai",
            name="Local OpenAI",
            kind="openai",
            enabled=True,
            base_url="http://local-ai:8000/v1",
            default_realtime_model="local-voice-v2",
            default_voice="local-speaker",
        )
        flow = FlowConfig(
            provider_id="openai",
            model="local-voice-v2",
            voice="local-speaker",
            steps=[
                PipelineStepConfig(
                    id="llm", kind="llm", label="Model", integration_id="openai"
                )
            ],
        )
        config = RuntimeConfig(
            integrations=[integration],
            flows=[flow],
            openai_api_key="never-send-to-local",
        )
        with tempfile.TemporaryDirectory() as directory:
            store = ConfigStore(Path(directory) / "test.json")
            store.save(config)
            loaded = store.load()
        self.assertEqual(loaded.integration("openai").api_key, "")
        self.assertEqual(
            loaded.integration("openai").default_realtime_model, "local-voice-v2"
        )
        self.assertEqual(loaded.flows[0].model, "local-voice-v2")
        self.assertEqual(loaded.flows[0].voice, "local-speaker")

    def test_deepgram_nova_needs_a_local_turn_controller(self):
        config, flow, _ = composed("deepgram", "stt", default_model="nova-3")
        self.assertTrue(
            any(
                "Nova needs a Turn step" in err
                for err in _runtime_flow_errors(config, flow)
            )
        )

    def test_existing_turn_configuration_keeps_its_timing(self):
        flow = FlowConfig(
            steps=[
                PipelineStepConfig(
                    id="turn", kind="vad", label="Turn", settings={"mode": "local_vad"}
                )
            ]
        )
        params = _composed_user_params(flow)
        self.assertIsInstance(
            params.user_turn_strategies.stop[0], SpeechTimeoutUserTurnStopStrategy
        )

    def test_smart_turn_uses_bundled_local_model(self):
        flow = FlowConfig(
            steps=[
                PipelineStepConfig(
                    id="turn", kind="vad", label="Turn", settings={"mode": "smart_turn"}
                )
            ]
        )
        params = _composed_user_params(flow)
        self.assertIsInstance(
            params.user_turn_strategies.stop[0], TurnAnalyzerUserTurnStopStrategy
        )

    def test_removing_turn_step_does_not_instantiate_local_smart_turn(self):
        self.assertIsInstance(
            _composed_user_params(FlowConfig(steps=[])).user_turn_strategies,
            ExternalUserTurnStrategies,
        )

    def test_stt_only_default_model_does_not_get_lost(self):
        for kind in ("deepgram", "speechmatics", "soniox", "gradium"):
            integration = IntegrationConfig(
                id="test", name="Test", kind=kind, default_model="custom-stt"
            )
            self.assertEqual(_step_model_for(None, integration, "stt"), "custom-stt")

    def test_flux_language_is_validated_without_silent_model_switch(self):
        config, flow, integration = composed(
            "deepgram", "stt", default_model="flux-general-en", language="pl"
        )
        self.assertTrue(
            any(
                "does not support language pl" in err
                for err in _runtime_flow_errors(config, flow)
            )
        )
        self.assertEqual(integration.default_model, "flux-general-en")

    def test_deepgram_model_picker_includes_flux(self):
        integration = IntegrationConfig(id="test", name="Test", kind="deepgram")
        self.assertIn(
            "flux-general-en",
            {entry["id"] for entry in _static_models_for(integration, "stt")},
        )

    def test_mcp_prompt_is_session_scoped(self):
        flow = FlowConfig(instructions="Original")
        updated = _flow_with_mcp_context(
            flow, SimpleNamespace(prompt_context="Household memory")
        )
        self.assertIn("Household memory", updated.instructions)
        self.assertEqual(flow.instructions, "Original")

    def test_visual_flow_uses_bundled_pipecat_flows(self):
        flow = FlowConfig(
            conversation_flow={
                "enabled": True,
                "initial_node_id": "start",
                "nodes": [
                    {
                        "id": "start",
                        "type": "initial",
                        "data": {
                            "functions": [{"name": "finish", "next_node_id": "end"}]
                        },
                    },
                    {"id": "end", "type": "end", "data": {}},
                ],
            }
        )
        node = _flow_node_configs(flow, None)
        self.assertIsInstance(node["functions"][0], FlowsFunctionSchema)

    def test_visual_flow_keeps_mcp_context_with_its_own_role_message(self):
        flow = FlowConfig(
            instructions="House context",
            conversation_flow={
                "enabled": True,
                "initial_node_id": "start",
                "nodes": [
                    {
                        "id": "start",
                        "type": "initial",
                        "data": {
                            "role_messages": [
                                {"role": "system", "content": "Order food"}
                            ]
                        },
                    }
                ],
            },
        )
        node = _flow_node_configs(flow, None)
        self.assertIn("House context", node["role_message"])
        self.assertIn("Order food", node["role_message"])


class FailureAndFlowTests(unittest.IsolatedAsyncioTestCase):
    async def test_gemini_key_is_not_part_of_http_urls(self):
        client = AsyncMock()
        response = SimpleNamespace(
            raise_for_status=lambda: None, json=lambda: {"candidates": []}
        )
        client.post.return_value = response
        manager = AsyncMock()
        manager.__aenter__.return_value = client
        with patch("app.main.httpx.AsyncClient", return_value=manager):
            await _gemini_generate_content("test-secret", "test-model", {})
        self.assertNotIn("test-secret", client.post.call_args.args[0])
        self.assertEqual(
            client.post.call_args.kwargs["headers"]["x-goog-api-key"], "test-secret"
        )

    async def test_legacy_speechmatics_partial_and_final_frames_stay_ordered(self):
        service = SpeechmaticsRealtimeSTTService(
            api_key="test", model="enhanced", language="pl"
        )
        service.push_frame = AsyncMock()
        service.request_finalize()
        task = asyncio.create_task(service._receive_transcripts())
        await service._events.put(
            {"message": "AddPartialTranscript", "metadata": {"transcript": "Hello"}}
        )
        await service._events.put(
            {"message": "AddTranscript", "metadata": {"transcript": "Hello there."}}
        )
        await asyncio.sleep(0.01)
        task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await task
        frames = [call.args[0] for call in service.push_frame.await_args_list]
        self.assertEqual([frame.text for frame in frames], ["Hello", "Hello there."])
        self.assertEqual(type(frames[0]).__name__, "InterimTranscriptionFrame")
        self.assertEqual(type(frames[1]).__name__, "TranscriptionFrame")
        self.assertTrue(service._finalize_pending)
        await service.cleanup()

    async def test_full_audio_queue_propagates_provider_failure_promptly(self):
        queue = asyncio.Queue(maxsize=1)
        await queue.put(b"full")

        async def fail():
            await asyncio.sleep(0.01)
            raise RuntimeError("provider unavailable")

        provider = asyncio.create_task(fail())
        with self.assertRaisesRegex(RuntimeError, "provider unavailable"):
            await asyncio.wait_for(_queue_stream_audio(queue, provider, b"next"), 0.8)
        self.assertTrue(provider.done())

    async def test_finished_provider_does_not_block_audio_queue(self):
        queue = asyncio.Queue(maxsize=1)
        await queue.put(b"full")
        provider = asyncio.create_task(asyncio.sleep(0))
        await provider
        await asyncio.wait_for(_queue_stream_audio(queue, provider, None), 0.1)

    async def test_mcp_is_closed_if_runtime_construction_fails(self):
        bridge = AsyncMock()
        bridge.__aenter__.return_value = bridge
        config = SimpleNamespace(enabled_mcp_servers=lambda token: [{"id": "ha"}])
        flow = FlowConfig(mcp_enabled=True)
        with (
            patch("app.main.CombinedMCPBridge", return_value=bridge),
            patch("app.main._run_bot_session", side_effect=RuntimeError("invalid STT")),
            self.assertRaisesRegex(RuntimeError, "invalid STT"),
        ):
            await run_bot(None, None, config, flow)
        bridge.__aexit__.assert_awaited_once()

    async def test_visual_flow_global_tools_keep_mcp_and_web_search(self):
        bridge = AsyncMock()
        bridge.call_tool.return_value = "MCP result"

        async def search(params):
            await params.result_callback("Search result")

        mcp = FunctionSchema(
            name="house_status", description="Read house", properties={}, required=[]
        )
        web = SimpleNamespace(
            name="web_search",
            description="Search",
            properties={},
            required=[],
            handler=search,
        )
        tools = ToolsSchema(
            standard_tools=[
                mcp,
                FunctionSchema(
                    name=web.name,
                    description=web.description,
                    properties={},
                    required=[],
                ),
            ]
        )
        functions = {fn.name: fn for fn in _flow_global_functions(tools, bridge, [web])}
        self.assertEqual(
            await functions["house_status"].handler({}, None), ("MCP result", None)
        )
        self.assertEqual(
            await functions["web_search"].handler({}, None), ("Search result", None)
        )


class MCPUpgradeTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        MCP_CALL_HISTORY.clear()
        MCP_TOOLS_SCHEMA_CACHE.clear()

    async def test_tool_error_is_not_reported_as_success(self):
        client = RecordingMCPClient(
            server_params=StreamableHttpParameters(url="http://ha/api/mcp")
        )
        session = AsyncMock()
        session.call_tool.return_value = SimpleNamespace(
            isError=True, content=[SimpleNamespace(text="Denied")]
        )
        with (
            patch.object(client, "_open_session", return_value=session),
            self.assertRaisesRegex(RuntimeError, "Denied"),
        ):
            await client.call_tool("test", {})
        self.assertFalse(MCP_CALL_HISTORY[-1]["ok"])

    async def test_tool_uses_new_pipecat_session_lifecycle(self):
        client = RecordingMCPClient(
            server_params=StreamableHttpParameters(url="http://ha/api/mcp")
        )
        session = AsyncMock()
        session.call_tool.return_value = SimpleNamespace(
            isError=False, content=[SimpleNamespace(text="Done")]
        )
        with patch.object(client, "_open_session", return_value=session):
            self.assertEqual(await client.call_tool("test", {}), "Done")
        self.assertTrue(MCP_CALL_HISTORY[-1]["ok"])

    async def test_prompt_is_not_cached_with_tools(self):
        bridge = HomeAssistantMCPBridge("http://ha/api/mcp")
        bridge.client = AsyncMock()
        bridge.client.tools.return_value = ToolsSchema(standard_tools=[])
        bridge.client.prompt_context.side_effect = ["Before", "After"]
        combined = CombinedMCPBridge([])
        combined.bridges = [({"id": "ha", "include_prompts": True}, bridge)]
        await combined.tools_schema()
        self.assertIn("Before", combined.prompt_context)
        await combined.tools_schema()
        self.assertIn("After", combined.prompt_context)
        bridge.client.tools.assert_awaited_once()

    async def test_tools_cache_is_scoped_to_credentials(self):
        for token, name in (("user-a", "tool_a"), ("user-b", "tool_b")):
            bridge = HomeAssistantMCPBridge("http://ha/api/mcp", token)
            bridge.client = AsyncMock()
            bridge.client.tools.return_value = ToolsSchema(
                standard_tools=[
                    FunctionSchema(
                        name=name, description=name, properties={}, required=[]
                    )
                ]
            )
            tools = await bridge.tools_schema()
            self.assertEqual(tools.standard_tools[0].name, name)

    async def test_prompt_api_uses_current_public_mcp_messages(self):
        client = RecordingMCPClient(
            server_params=StreamableHttpParameters(url="http://ha/api/mcp")
        )
        session = AsyncMock()
        session.list_prompts.return_value = SimpleNamespace(
            prompts=[SimpleNamespace(name="Sentient", arguments=[])]
        )
        session.get_prompt.return_value = SimpleNamespace(
            messages=[
                SimpleNamespace(
                    content=SimpleNamespace(type="text", text="House rules")
                )
            ]
        )
        with patch.object(client, "_open_session", return_value=session):
            self.assertEqual(await client.prompt_context(), "House rules")


class FluxStreamTests(unittest.IsolatedAsyncioTestCase):
    async def test_partial_transcript_is_streamed_and_final_replaces_it(self):
        queue = asyncio.Queue()
        await queue.put(b"\x00\x00" * 320)
        await queue.put(None)
        browser = AsyncMock()
        provider = AsyncMock()

        async def events():
            await asyncio.sleep(0)
            yield json.dumps({"type": "Connected"})
            yield json.dumps(
                {"type": "TurnInfo", "event": "Update", "transcript": "Hello"}
            )
            yield json.dumps(
                {"type": "TurnInfo", "event": "EndOfTurn", "transcript": "Hello there"}
            )

        provider.__aiter__ = lambda self: events()
        manager = AsyncMock()
        manager.__aenter__.return_value = provider
        integration = IntegrationConfig(
            id="test", name="Flux", kind="deepgram", api_key="test"
        )
        with patch("app.main._websocket_connect", return_value=manager) as connect:
            result = await _deepgram_flux_transcribe_stream(
                websocket=browser,
                queue=queue,
                integration=integration,
                model="flux-general-en",
                metadata={"sample_rate": 16000},
            )
        self.assertEqual(result, "Hello there")
        self.assertIn("/v2/listen", connect.call_args.args[0])
        self.assertEqual(browser.send_json.await_args_list[0].args[0]["text"], "Hello")


if __name__ == "__main__":
    unittest.main()
